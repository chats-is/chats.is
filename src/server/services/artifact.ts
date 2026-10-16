import '@tanstack/react-start/server-only';

import { generateId } from 'ai';
import { and, eq } from 'drizzle-orm';
import ts from 'typescript';
import { type z } from 'zod';

import {
  type Artifact,
  type ChatMessage,
  type CreateArtifactInput,
  type PreviewPackage,
  type UpdateArtifactInput
} from '@/types';
import { type artifactDuplicateSchema } from '@/types/artifact';
import {
  assertArtifactPayload,
  buildPreviewFiles,
  getArtifactVirtualPath,
  isPreviewableCodeArtifact,
  looksLikeJsx,
  previewPackageImports,
  validatePreviewImports,
  type PreviewFile
} from '@/lib/artifact';
import { normalizeCodeLanguage } from '@/lib/code-language';
import { attachmentNames } from '@/lib/document';
import { generateUUID } from '@/lib/utils';
import { db } from '@/db';
import { artifacts, chats, messages, shares } from '@/db/schema';
import { PublicError } from '@/server/public-error';
import {
  copyAsAttachment,
  isOwnBlobUrl,
  isUsersOwnFile
} from '@/server/services/blob';
import { messagesUpTo } from '@/server/services/message';

/**
 * One artifact with its full content, or null when the id names nothing the
 * user owns. Library downloads read through here; the list feed carries only
 * a truncated preview.
 */
export async function getArtifact(userId: string, id: string) {
  const artifact = await db.query.artifacts.findFirst({
    where: and(eq(artifacts.id, id), eq(artifacts.userId, userId)),
    columns: {
      userId: false
    }
  });
  return artifact ?? null;
}

/**
 * Every artifact in one of the user's chats, oldest first. Each is an
 * independent product of the message that created it; the canvas switches
 * between them.
 */
export async function listArtifacts(userId: string, chatId: string) {
  return await db.query.artifacts.findMany({
    where: and(eq(artifacts.chatId, chatId), eq(artifacts.userId, userId)),
    orderBy: (artifacts, { asc }) => [asc(artifacts.createdAt)],
    columns: {
      userId: false
    }
  });
}

/**
 * A new chat of the user's that begins with a duplicate of an artifact: one
 * of their own, or one shared on its own, by its link. The original and its
 * chat are left as they were; the chat is named after it, with "(Copy)"
 * after the name.
 *
 * The chat opens as an ordinary exchange: the user asking for the duplicate,
 * with the files the artifact can read, and a reply that makes it with
 * create_artifact. The model sees an artifact it made, and changes it with
 * update_artifact, rather than being handed text to write out again. The
 * files keep the names the artifact reads them by. Someone else's are copied
 * into the user's own: deleting the chat they came from deletes them.
 *
 * Answers the new chat's id and the duplicate's.
 */
export async function duplicateArtifact(
  userId: string,
  input: z.infer<typeof artifactDuplicateSchema>
): Promise<{ chatId: string; artifactId: string }> {
  const source = await duplicateSource(userId, input.from);
  if (!source) {
    throw new PublicError('This is no longer available.');
  }

  const history = await messagesUpTo(source.chatId, source.messageId);
  const mediaTypes = new Map<string, string>();
  for (const message of history) {
    if (message.role !== 'user') continue;
    for (const part of message.parts) {
      if (part.type === 'file' && !mediaTypes.has(part.url)) {
        mediaTypes.set(part.url, part.mediaType);
      }
    }
  }
  const files = await Promise.all(
    [...attachmentNames(history)].map(async ([url, name]) => ({
      type: 'file' as const,
      mediaType: mediaTypes.get(url) ?? 'application/octet-stream',
      filename: name,
      url:
        isOwnBlobUrl(url) && !isUsersOwnFile(url, userId)
          ? await copyAsAttachment(url, userId)
          : url
    }))
  );

  const chatId = generateUUID();
  const questionId = generateUUID();
  const replyId = generateUUID();
  const artifactId = generateUUID();
  // Stamped here rather than by the database, which gives every row of one
  // transaction the same time: the reply has to come after the question.
  const asked = new Date();
  const answered = new Date(asked.getTime() + 1);
  const created: CreateArtifactInput = {
    title: source.title,
    type: source.type,
    content: source.content ?? '',
    ...(source.language && { language: source.language }),
    ...(source.fileName && { fileName: source.fileName })
  };
  const question: ChatMessage['parts'] = [
    ...files,
    { type: 'text', text: `Duplicate “${source.title}”` }
  ];
  const reply: ChatMessage['parts'] = [
    {
      type: 'tool-create_artifact',
      // The shape most providers give a call's id; any will do, so long as
      // it is the chat's only one.
      toolCallId: `call_${generateId()}`,
      state: 'output-available',
      input: created,
      output: { id: artifactId }
    }
  ];

  await db.transaction(async tx => {
    await tx.insert(chats).values({
      id: chatId,
      title: `${source.title} (Copy)`,
      // None: the chat opens on the model the user has chosen, settled by the
      // page as for a chat whose model has since been switched off.
      modelId: '',
      userId,
      createdAt: asked,
      updatedAt: answered
    });
    await tx.insert(messages).values([
      {
        id: questionId,
        role: 'user',
        parts: question,
        chatId,
        userId,
        createdAt: asked,
        updatedAt: asked
      },
      {
        id: replyId,
        parentId: questionId,
        role: 'assistant',
        parts: reply,
        chatId,
        userId,
        createdAt: answered,
        updatedAt: answered
      }
    ]);
    await tx.insert(artifacts).values({
      id: artifactId,
      chatId,
      messageId: replyId,
      userId,
      title: source.title,
      type: source.type,
      language: source.language,
      content: source.content,
      fileName: source.fileName,
      createdAt: answered,
      updatedAt: answered
    });
  });

  return { chatId, artifactId };
}

/** The artifact duplicated: the user's own, or the one a link shares on its
 *  own, made by whoever shared it. */
async function duplicateSource(
  userId: string,
  from: z.infer<typeof artifactDuplicateSchema>['from']
) {
  if ('artifactId' in from) {
    return await db.query.artifacts.findFirst({
      where: and(
        eq(artifacts.id, from.artifactId),
        eq(artifacts.userId, userId)
      )
    });
  }
  const link = await db.query.shares.findFirst({
    where: eq(shares.id, from.shareId),
    columns: { artifactId: true, userId: true }
  });
  if (!link?.artifactId) return undefined;
  return await db.query.artifacts.findFirst({
    where: and(
      eq(artifacts.id, link.artifactId),
      eq(artifacts.userId, link.userId)
    )
  });
}

/**
 * A preview compiled for the sandboxed frame: its entry, each file as
 * CommonJS, and the packages they import, which the frame loads first.
 */
export type CompiledPreview = {
  entryPath: string;
  files: Record<string, string>;
  imports: PreviewPackage[];
};

// Same canonicalization the client uses (react→tsx etc. via the shared alias
// table) so both sides agree on what compiles; unknown languages pass through
// (they're skipped below) and a missing language defaults to tsx.
const normalizePreviewLanguage = (language?: string) =>
  normalizeCodeLanguage(language) ??
  (language ? language.toLowerCase().trim() : 'tsx');

/**
 * One compile error, said where it is: the line and column, the line itself,
 * and a caret under the spot. The message alone sends whoever fixes it —
 * the reader, or the model told it — looking through the whole file.
 */
const describeDiagnostic = (path: string, diagnostic: ts.Diagnostic) => {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return `${path}: ${message}`;
  }

  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start
  );
  const source = diagnostic.file.text.split(/\r?\n/)[line] ?? '';
  // Tabs kept as tabs, so the caret lands under the column it names.
  const indent = source.slice(0, character).replace(/[^\t]/g, ' ');
  return `${path}:${line + 1}:${character + 1}: ${message}\n  ${source.trimEnd()}\n  ${indent}^`;
};

/**
 * Compile a preview for the sandboxed frame, or say why it cannot be.
 *
 * Syntax only: `transpileModule` checks no types, so a name that is never
 * defined compiles and fails in the frame. What it catches, it catches before
 * anything runs — for the preview endpoint, and for the artifact tools before
 * an artifact is kept.
 */
export function compilePreview(input: {
  entryPath: string;
  files: PreviewFile[];
}): CompiledPreview | { error: string } {
  const { entryPath, files } = input;
  const compiledFiles: Record<string, string> = {};
  const imports = new Set<PreviewPackage>();
  const errors: string[] = [];
  // An artifact is previewed under two paths with the same source, so each
  // source is compiled once — and its errors said once, not once per path.
  const compiledByCode = new Map<string, string | null>();
  let hasEntry = false;

  for (const file of files) {
    if (file.path === entryPath) {
      hasEntry = true;
    }

    const requestedLanguage = normalizePreviewLanguage(file.language);
    const normalizedLanguage =
      requestedLanguage === 'typescript' && looksLikeJsx(file.code)
        ? 'tsx'
        : requestedLanguage === 'javascript' && looksLikeJsx(file.code)
          ? 'jsx'
          : requestedLanguage;

    if (
      !['tsx', 'jsx', 'typescript', 'javascript'].includes(normalizedLanguage)
    ) {
      continue;
    }

    const earlier = compiledByCode.get(file.code);
    if (earlier !== undefined) {
      if (earlier !== null) compiledFiles[file.path] = earlier;
      continue;
    }

    const unsupportedImports = validatePreviewImports(file.code);
    if (unsupportedImports.length > 0) {
      errors.push(
        `${file.path}: Only React and the listed packages can be imported. Unsupported imports: ${unsupportedImports.join(', ')}`
      );
      compiledByCode.set(file.code, null);
      continue;
    }

    const output = ts.transpileModule(file.code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      },
      reportDiagnostics: true,
      fileName: file.path
    });

    const fileErrors =
      output.diagnostics
        ?.filter(
          diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
        )
        .map(diagnostic => describeDiagnostic(file.path, diagnostic)) ?? [];

    if (fileErrors.length > 0) {
      errors.push(...fileErrors);
      compiledByCode.set(file.code, null);
      continue;
    }

    compiledFiles[file.path] = output.outputText;
    compiledByCode.set(file.code, output.outputText);
    for (const pkg of previewPackageImports(file.code)) imports.add(pkg);
  }

  if (!hasEntry) {
    return { error: `Entry file not found: ${entryPath}` };
  }

  if (errors.length > 0) {
    return { error: errors.join('\n\n') };
  }

  if (!compiledFiles[entryPath]) {
    return { error: `Preview does not support ${entryPath}` };
  }

  return { entryPath, files: compiledFiles, imports: [...imports] };
}

/**
 * The artifact a `create_artifact` call makes — or an `update_artifact` call,
 * through `editArtifact` — checked as the tool must check it: a throw here is
 * what the model is told, and nothing is kept.
 *
 * A previewable one is compiled first, so a syntax error goes back to the
 * model while it still has steps to fix it in, rather than to the reader as
 * a preview that fails.
 */
export function buildArtifact(
  input: CreateArtifactInput,
  owner: { id: string; chatId: string; messageId: string }
): Artifact {
  assertArtifactPayload(input);

  if (isPreviewableCodeArtifact(input) && input.content.trim()) {
    const source = { ...input, id: owner.id };
    const compiled = compilePreview({
      entryPath: getArtifactVirtualPath(source),
      files: buildPreviewFiles(source)
    });
    if ('error' in compiled) {
      throw new Error(
        `The artifact did not compile, so it was not saved. Fix these errors and call the tool again:\n\n${compiled.error}`
      );
    }
  }

  const now = new Date();
  return {
    id: owner.id,
    chatId: owner.chatId,
    messageId: owner.messageId,
    title: input.title,
    type: input.type,
    language: input.language ?? null,
    content: input.content,
    fileName: input.fileName ?? null,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * The artifact an `update_artifact` call makes: `source` with one passage of
 * it replaced, as a new artifact of the reply making the change. `source` is
 * left as it was, so each reply's card goes on showing what that reply made,
 * and a reply regenerated takes its own change away with it.
 *
 * The passage must appear exactly once, or which one was meant is a guess.
 * Not found, the model is told the version it named as it stands, since that
 * is what it got wrong — and which version that is, since it may have meant
 * another.
 */
export function editArtifact(
  source: Artifact,
  edit: UpdateArtifactInput,
  owner: { id: string; chatId: string; messageId: string }
): Artifact {
  const content = source.content ?? '';
  const at = content.indexOf(edit.oldStr);
  if (at === -1) {
    throw new Error(
      `oldStr was not found in the version you named, ${edit.id}, with any changes this reply has already made to it. Copy it exactly from that version, which is:\n\n${content}`
    );
  }
  if (content.indexOf(edit.oldStr, at + 1) !== -1) {
    throw new Error(
      'oldStr appears in the artifact more than once. Include enough of the text around it to match exactly once.'
    );
  }

  return buildArtifact(
    {
      title: source.title,
      type: source.type,
      language: source.language ?? undefined,
      fileName: source.fileName ?? undefined,
      content:
        content.slice(0, at) +
        edit.newStr +
        content.slice(at + edit.oldStr.length)
    },
    owner
  );
}
