import { makeTestDb } from '@/test-utils/pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/db/schema';

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));
vi.mock('@/lib/env', () => ({
  env: { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_store123_secret' }
}));
// A copy lands at the path asked for, as the store's own would.
const copy = vi.hoisted(() =>
  vi.fn(async (_url: string, pathname: string) => ({
    url: `https://store123.public.blob.vercel-storage.com/${pathname}`
  }))
);
vi.mock('@vercel/blob', () => ({ copy, del: vi.fn() }));

const { buildArtifact, compilePreview, duplicateArtifact, editArtifact } =
  await import('./artifact');

const owner = { id: 'a1', chatId: 'c1', messageId: 'm1' };

const reactArtifact = (content: string) => ({
  title: 'Counter',
  type: 'code' as const,
  language: 'tsx',
  fileName: 'index.tsx',
  content
});

describe('compilePreview', () => {
  it('compiles each file to CommonJS', () => {
    const result = compilePreview({
      entryPath: '/index.tsx',
      files: [
        {
          path: '/index.tsx',
          code: 'export default function App() { return <div>Hi</div>; }',
          language: 'tsx'
        }
      ]
    });

    expect(result).toMatchObject({ entryPath: '/index.tsx', imports: [] });
    expect('files' in result && result.files['/index.tsx']).toContain(
      'exports.default = App'
    );
  });

  it('says which packages the frame has to load', () => {
    const result = compilePreview({
      entryPath: '/index.tsx',
      files: [
        {
          path: '/index.tsx',
          code: "import * as d3 from 'd3';\nimport { Button } from '@/components/ui/button';\nexport default () => <Button>{d3.max([1, 2])}</Button>;",
          language: 'tsx'
        }
      ]
    });

    expect(result).toMatchObject({
      imports: ['d3', '@/components/ui/button']
    });
  });

  it('says where a syntax error is, with the line and a caret', () => {
    const result = compilePreview({
      entryPath: '/index.tsx',
      files: [
        {
          path: '/index.tsx',
          code: 'const a = 1;\nconst b = (;\n',
          language: 'tsx'
        }
      ]
    });

    expect('error' in result && result.error).toContain('/index.tsx:2:12:');
    expect('error' in result && result.error).toContain(
      '  const b = (;\n             ^'
    );
  });

  it('says an error once for a source previewed under two paths', () => {
    const code = 'export default function App() { return <div>; }';
    const result = compilePreview({
      entryPath: '/index.tsx',
      files: [
        { path: '/index.tsx', code, language: 'tsx' },
        { path: '/App.tsx', code, language: 'tsx' }
      ]
    });

    expect('error' in result).toBe(true);
    expect('error' in result && result.error).not.toContain('/App.tsx');
  });

  it('refuses a package the frame does not have', () => {
    const result = compilePreview({
      entryPath: '/index.tsx',
      files: [
        {
          path: '/index.tsx',
          code: "import moment from 'moment';\nexport default () => null;",
          language: 'tsx'
        }
      ]
    });

    expect('error' in result && result.error).toContain('moment');
  });
});

describe('buildArtifact', () => {
  it('keeps a React artifact that compiles, as the row it becomes', () => {
    const artifact = buildArtifact(
      reactArtifact('export default function App() { return <div>Hi</div>; }'),
      owner
    );

    expect(artifact).toMatchObject({
      id: 'a1',
      chatId: 'c1',
      messageId: 'm1',
      title: 'Counter',
      type: 'code',
      language: 'tsx',
      fileName: 'index.tsx'
    });
  });

  it('throws what does not compile, for the model to fix', () => {
    expect(() =>
      buildArtifact(
        reactArtifact('export default function App() { return <div>; }'),
        owner
      )
    ).toThrow(/did not compile, so it was not saved[\s\S]*index\.tsx:1:/);
  });

  it('does not compile what has no preview', () => {
    const artifact = buildArtifact(
      {
        title: 'Script',
        type: 'code',
        language: 'python',
        content: 'def broken(:'
      },
      owner
    );

    expect(artifact.content).toBe('def broken(:');
  });
});

describe('editArtifact', () => {
  const source = {
    id: 'a1',
    chatId: 'c1',
    messageId: 'm1',
    title: 'Counter',
    type: 'code' as const,
    language: 'tsx',
    fileName: 'index.tsx',
    content:
      'export default function App() {\n  return <div>{undefinedThing}</div>;\n}\n',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const reply = { id: 'a2', chatId: 'c1', messageId: 'm2' };

  it('makes a new artifact for the reply, with the passage replaced', () => {
    const edited = editArtifact(
      source,
      {
        id: 'a1',
        oldStr: 'export default function App() {\n',
        newStr: 'export default function App() {\n  const undefinedThing = 0;\n'
      },
      reply
    );

    expect(edited).toMatchObject({
      id: 'a2',
      messageId: 'm2',
      title: 'Counter',
      fileName: 'index.tsx',
      content:
        'export default function App() {\n  const undefinedThing = 0;\n  return <div>{undefinedThing}</div>;\n}\n'
    });
    // The artifact it came from is left as it was.
    expect(source.content).toContain('return <div>{undefinedThing}</div>');
    expect(source.content).not.toContain('const undefinedThing');
  });

  it('tells the model the artifact as it is when the passage is not in it', () => {
    expect(() =>
      editArtifact(source, { id: 'a1', oldStr: 'not there', newStr: '' }, reply)
    ).toThrow(/oldStr was not found[\s\S]*return <div>\{undefinedThing\}/);
  });

  it('refuses a passage that appears more than once', () => {
    expect(() =>
      editArtifact(source, { id: 'a1', oldStr: 'div', newStr: 'span' }, reply)
    ).toThrow('more than once');
  });

  it('keeps nothing that does not compile', () => {
    expect(() =>
      editArtifact(source, { id: 'a1', oldStr: '</div>', newStr: '' }, reply)
    ).toThrow('did not compile');
  });
});

describe('duplicateArtifact', () => {
  let client: { close?: () => Promise<void> } | undefined;
  const STORE = 'https://store123.public.blob.vercel-storage.com/uploads';
  const file = (owner: string, name: string) => ({
    type: 'file' as const,
    mediaType: 'text/csv',
    url: `${STORE}/attachments/${owner}/${name}`,
    filename: 'data.csv'
  });
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute));

  beforeAll(async () => {
    const t = await makeTestDb();
    h.db = t.db;
    client = t.client;

    // The owner's chat: two files attached under one name, then the reply
    // that made the artifact; a file attached after it is not the
    // artifact's to read.
    await h.db.insert(schema.users).values([
      { id: 'owner', name: 'Owner', email: 'owner@example.com' },
      { id: 'other', name: 'Other', email: 'other@example.com' }
    ]);
    await h.db.insert(schema.chats).values([
      { id: 'c1', title: 'Chat', userId: 'owner', modelId: 'm' },
      { id: 'c2', title: 'Shared chat', userId: 'owner', modelId: 'm' },
      { id: 'c3', title: 'Private chat', userId: 'owner', modelId: 'm' }
    ]);
    await h.db.insert(schema.messages).values([
      {
        id: 'u1',
        chatId: 'c1',
        userId: 'owner',
        role: 'user',
        parts: [file('owner', 'a.csv'), file('owner', 'b.csv')],
        createdAt: at(1)
      },
      {
        id: 'r1',
        parentId: 'u1',
        chatId: 'c1',
        userId: 'owner',
        role: 'assistant',
        parts: [],
        createdAt: at(2)
      },
      {
        id: 'u2',
        chatId: 'c1',
        userId: 'owner',
        role: 'user',
        parts: [file('owner', 'later.csv')],
        createdAt: at(3)
      },
      {
        id: 'r2',
        chatId: 'c2',
        userId: 'owner',
        role: 'assistant',
        parts: [],
        createdAt: at(4)
      },
      {
        id: 'r3',
        chatId: 'c3',
        userId: 'owner',
        role: 'assistant',
        parts: [],
        createdAt: at(5)
      }
    ]);
    // Shared on its own; in a shared chat; and in neither.
    await h.db.insert(schema.artifacts).values([
      {
        id: 'art',
        chatId: 'c1',
        messageId: 'r1',
        userId: 'owner',
        title: 'Counter',
        type: 'code',
        language: 'tsx',
        fileName: 'index.tsx',
        content: 'export default () => null'
      },
      {
        id: 'art-in-chat',
        chatId: 'c2',
        messageId: 'r2',
        userId: 'owner',
        title: 'Notes',
        type: 'text',
        content: 'notes'
      },
      {
        id: 'art-private',
        chatId: 'c3',
        messageId: 'r3',
        userId: 'owner',
        title: 'Draft',
        type: 'text',
        content: 'draft'
      }
    ]);
    await h.db.insert(schema.shares).values([
      { id: 'art-link', artifactId: 'art', userId: 'owner' },
      { id: 'chat-link', chatId: 'c2', userId: 'owner' }
    ]);
  });

  afterAll(async () => {
    await client?.close?.();
  });

  const opened = async (chatId: string) => ({
    chat: await h.db.query.chats.findFirst({
      where: eq(schema.chats.id, chatId)
    }),
    messages: await h.db.query.messages.findMany({
      where: eq(schema.messages.chatId, chatId),
      orderBy: (m: typeof schema.messages, { asc }: any) => [asc(m.createdAt)]
    }),
    artifacts: await h.db.query.artifacts.findMany({
      where: eq(schema.artifacts.chatId, chatId)
    })
  });

  it("opens a chat of the user's own with a duplicate of their artifact", async () => {
    copy.mockClear();
    const { chatId, artifactId } = await duplicateArtifact('owner', {
      artifactId: 'art'
    });
    const { chat, messages, artifacts } = await opened(chatId);

    // No model of its own: the page opens it on the one the user has chosen.
    expect(chat).toMatchObject({
      title: 'Counter (Copy)',
      userId: 'owner',
      modelId: ''
    });
    expect(messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    const [question, reply] = messages;
    // Their own files are theirs already, and keep the names the artifact
    // reads them by.
    expect(copy).not.toHaveBeenCalled();
    expect(question.parts).toEqual([
      { ...file('owner', 'a.csv'), filename: 'data.csv' },
      { ...file('owner', 'b.csv'), filename: 'data (2).csv' },
      { type: 'text', text: 'Duplicate “Counter”' }
    ]);
    expect(reply.parentId).toBe(question.id);
    expect(reply.parts).toEqual([
      expect.objectContaining({
        type: 'tool-create_artifact',
        state: 'output-available',
        input: {
          title: 'Counter',
          type: 'code',
          language: 'tsx',
          fileName: 'index.tsx',
          content: 'export default () => null'
        },
        output: { id: artifactId }
      })
    ]);
    expect(artifacts).toEqual([
      expect.objectContaining({
        id: artifactId,
        title: 'Counter',
        messageId: reply.id,
        userId: 'owner',
        content: 'export default () => null'
      })
    ]);
    // The original stays where it was.
    expect(
      await h.db.query.artifacts.findFirst({
        where: eq(schema.artifacts.id, 'art')
      })
    ).toMatchObject({ chatId: 'c1', messageId: 'r1' });
  });

  it("copies someone else's files into the user's own, when it is shared", async () => {
    copy.mockClear();
    const { chatId } = await duplicateArtifact('other', { artifactId: 'art' });
    const { messages } = await opened(chatId);

    expect(copy).toHaveBeenCalledTimes(2);
    const files = messages[0].parts.filter((p: any) => p.type === 'file');
    expect(files.map((p: any) => p.filename)).toEqual([
      'data.csv',
      'data (2).csv'
    ]);
    for (const part of files) {
      expect(part.url).toMatch(`${STORE}/attachments/other/`);
    }
  });

  it('duplicates someone else’s artifact in a chat they shared', async () => {
    const { chatId } = await duplicateArtifact('other', {
      artifactId: 'art-in-chat'
    });
    const { chat, artifacts } = await opened(chatId);

    expect(chat).toMatchObject({ title: 'Notes (Copy)', userId: 'other' });
    expect(artifacts).toEqual([
      expect.objectContaining({ title: 'Notes', content: 'notes' })
    ]);
  });

  it('refuses someone else’s artifact that no link shows', async () => {
    await expect(
      duplicateArtifact('other', { artifactId: 'art-private' })
    ).rejects.toThrow('no longer available');
    await expect(
      duplicateArtifact('other', { artifactId: 'missing' })
    ).rejects.toThrow('no longer available');
    // Only a link its maker made counts: one in another's name does not.
    await h.db
      .insert(schema.shares)
      .values({ id: 'not-theirs', chatId: 'c3', userId: 'other' });
    await expect(
      duplicateArtifact('other', { artifactId: 'art-private' })
    ).rejects.toThrow('no longer available');
  });

  it('refuses it once the link that showed it is taken back', async () => {
    await h.db.delete(schema.shares).where(eq(schema.shares.id, 'chat-link'));

    await expect(
      duplicateArtifact('other', { artifactId: 'art-in-chat' })
    ).rejects.toThrow('no longer available');
    // Its owner still can.
    await expect(
      duplicateArtifact('owner', { artifactId: 'art-in-chat' })
    ).resolves.toMatchObject({ chatId: expect.any(String) });
  });
});
