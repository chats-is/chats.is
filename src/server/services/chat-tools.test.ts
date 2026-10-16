import { type InferUIMessageChunk } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Artifact, type ChatMessage, type Model } from '@/types';
import { getArtifact } from '@/server/services/artifact';
import { findModelByModelId, getAllModels } from '@/server/services/model';
import { getMediaDefaultModelIds } from '@/server/services/settings';
import { getUserTier } from '@/server/services/tier';

import {
  buildArtifactTools,
  buildMediaTools,
  buildMediaToolsSystemPrompt
} from './chat-tools';

/**
 * Which media tools a reply is offered, and on which model; and what one
 * reply's artifact tools keep. The models, the admin's defaults and the
 * user's tier are mocked at their module boundaries; the generators are never
 * reached, since no media tool is called here.
 */

vi.mock('@/lib/image-generation', () => ({ generateAndStoreImage: vi.fn() }));
vi.mock('@/lib/video-generation', () => ({
  generateAndStoreVideo: vi.fn(),
  VideoTimeoutError: class extends Error {}
}));
vi.mock('@/lib/speech-generation', () => ({
  generateAndStoreSpeech: vi.fn()
}));
vi.mock('@/lib/transcription', () => ({ transcribeAudio: vi.fn() }));
vi.mock('@/lib/provider', () => ({ resolveModelId: vi.fn() }));
vi.mock('@/server/services/blob', () => ({ isOwnBlobUrl: vi.fn() }));
vi.mock('@/server/services/preflight', () => ({ preflightCheck: vi.fn() }));
vi.mock('@/server/services/usage', () => ({
  recordAudioUsage: vi.fn(),
  recordImageUsage: vi.fn(),
  recordTranscriptionUsage: vi.fn(),
  recordVideoUsage: vi.fn()
}));
vi.mock('@/server/services/settings', () => ({
  getMediaDefaultModelIds: vi.fn()
}));
vi.mock('@/server/services/tier', () => ({ getUserTier: vi.fn() }));
// The artifacts of earlier replies are read from the database; what a call
// makes of them is the real thing.
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/server/services/artifact', async importOriginal => ({
  ...(await importOriginal<typeof import('@/server/services/artifact')>()),
  getArtifact: vi.fn()
}));

const image = (modelId: string): Model =>
  ({
    id: modelId,
    name: modelId,
    modelId,
    capability: 'image',
    isEnabled: true,
    // Its own aspect ratio, which the tool's description lists: how a test
    // tells which model the tool was offered with.
    uiOptions: { aspectRatios: [`ratio-of-${modelId}`] },
    providers: [
      {
        id: `b-${modelId}`,
        modelId,
        providerId: 'p1',
        isEnabled: true,
        priority: 0,
        provider: { id: 'p1', name: 'p1', type: 'openai', isEnabled: true }
      }
    ]
  }) as unknown as Model;

const models = [image('first'), image('second'), image('admin-default')];

vi.mock('@/server/services/model', () => ({
  getAllModels: vi.fn(),
  findModelByModelId: vi.fn(),
  usableCandidates: (model: Model) =>
    (model.providers ?? []).map(binding => binding.provider)
}));

const build = (selected?: string) =>
  buildMediaTools({
    userId: 'u1',
    chatId: 'c1',
    assistantMessageId: 'a1',
    mediaOptions: selected ? { image: { modelId: selected } } : undefined,
    chatMessages: []
  });

const tier = (mode: 'allow' | 'deny', modelIds: string[]) =>
  vi.mocked(getUserTier).mockResolvedValue({
    modelRestrictionMode: mode,
    modelIds
  } as Awaited<ReturnType<typeof getUserTier>>);

/** The image model the tool was offered with, read off its description. */
const imageModelOf = (tools: Awaited<ReturnType<typeof build>>['tools']) =>
  models.find(m =>
    String(tools.generate_image?.description).includes(`ratio-of-${m.modelId}`)
  )?.modelId;

beforeEach(() => {
  vi.clearAllMocks();
  // The service's own row type, which the client-safe `Model` stands in for.
  type Row = Awaited<ReturnType<typeof getAllModels>>[number];
  vi.mocked(getAllModels).mockResolvedValue(models as unknown as Row[]);
  vi.mocked(findModelByModelId).mockImplementation(
    async modelId =>
      models.find(m => m.modelId === modelId) as unknown as Row | undefined
  );
  vi.mocked(getMediaDefaultModelIds).mockResolvedValue({
    imageModelId: 'admin-default'
  } as Awaited<ReturnType<typeof getMediaDefaultModelIds>>);
});

describe('the image tool', () => {
  it('runs on the model the user picked, when their tier allows it', async () => {
    tier('allow', []);
    const { tools } = await build('second');
    expect(imageModelOf(tools)).toBe('second');
  });

  it('falls back to the admin’s default when the pick is refused', async () => {
    tier('deny', ['second']);
    const { tools } = await build('second');
    expect(imageModelOf(tools)).toBe('admin-default');
  });

  it('falls back to the first allowed when the default is refused too', async () => {
    tier('deny', ['second', 'admin-default']);
    const { tools } = await build('second');
    expect(imageModelOf(tools)).toBe('first');
  });

  it('is not offered when the tier allows no image model', async () => {
    tier('allow', ['some-chat-model']);
    const { tools } = await build('second');
    expect(tools.generate_image).toBeUndefined();
  });
});

describe('buildMediaToolsSystemPrompt', () => {
  it('says nothing when there are no media tools', () => {
    expect(buildMediaToolsSystemPrompt([])).toBe('');
  });

  it('with only transcription, speaks of transcripts and not of generated media', () => {
    const prompt = buildMediaToolsSystemPrompt(['transcribe_audio']);
    expect(prompt).toContain('A transcript is not displayed');
    expect(prompt).toContain('If the tool returns an error');
    expect(prompt).not.toContain('generated media renders');
    expect(prompt).not.toContain('map it to one of the values');
  });

  it('with generating tools, covers formats and how generated media shows', () => {
    const prompt = buildMediaToolsSystemPrompt([
      'generate_image',
      'edit_image',
      'transcribe_audio'
    ]);
    expect(prompt).toContain('map it to one of the values');
    expect(prompt).toContain('generated media renders');
    expect(prompt).toContain('A transcript is not displayed');
  });

  it('with only editing tools, leaves out formats, which they take none of', () => {
    const prompt = buildMediaToolsSystemPrompt(['edit_image', 'edit_video']);
    expect(prompt).toContain('generated media renders');
    expect(prompt).not.toContain('map it to one of the values');
    expect(prompt).not.toContain('A transcript is not displayed');
  });
});

describe('the artifact tools of one reply', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const earlier = (id: string, content: string, chatId = 'c1'): Artifact => ({
    id,
    chatId,
    messageId: 'm0',
    title: id,
    type: 'markdown',
    content,
    createdAt: at,
    updatedAt: at
  });
  const inDatabase = (...artifacts: Artifact[]) =>
    vi
      .mocked(getArtifact)
      .mockImplementation(
        async (_userId, id) =>
          (artifacts.find(a => a.id === id) ?? null) as Awaited<
            ReturnType<typeof getArtifact>
          >
      );

  // What the SDK hands a tool with each call.
  const call = (toolCallId: string) => ({
    toolCallId,
    messages: [],
    context: {}
  });

  const reply = () => {
    const parts: InferUIMessageChunk<ChatMessage>[] = [];
    const artifacts = buildArtifactTools({
      userId: 'u1',
      chatId: 'c1',
      messageId: 'm1',
      emit: part => parts.push(part)
    });
    let calls = 0;
    const options = () => call(`call${++calls}`);
    return {
      ...artifacts,
      parts,
      create: (input: {
        title: string;
        type: 'markdown' | 'code';
        content: string;
        language?: string;
        fileName?: string;
      }) =>
        artifacts.tools.create_artifact.execute(input, options()) as Promise<{
          id: string;
        }>,
      update: (id: string, oldStr: string, newStr: string) =>
        artifacts.tools.update_artifact.execute(
          { id, oldStr, newStr },
          options()
        ) as Promise<{ id: string }>
    };
  };

  it('keeps what create_artifact makes, and draws it on the canvas', async () => {
    const r = reply();
    const { id } = await r.create({
      title: 'Notes',
      type: 'markdown',
      content: '# Hi'
    });

    expect(r.kept()).toMatchObject([
      { id, title: 'Notes', content: '# Hi', chatId: 'c1', messageId: 'm1' }
    ]);
    expect(r.parts.map(part => part.type)).toEqual([
      'data-id',
      'data-title',
      'data-kind',
      'data-clear',
      'data-textDelta',
      'data-finish',
      'data-artifact'
    ]);
  });

  // Where an edit call has got to, as the SDK tells the tool.
  const written = async (
    update: ReturnType<typeof reply>['tools']['update_artifact'],
    toolCallId: string,
    ...deltas: string[]
  ) => {
    const options = call(toolCallId);
    await update.onInputStart?.(options);
    for (const inputTextDelta of deltas) {
      await update.onInputDelta?.({ ...options, inputTextDelta });
    }
    // The canvas is told once the calls before have done.
    await new Promise(resolve => setTimeout(resolve, 0));
    return options;
  };
  const editing = (parts: InferUIMessageChunk<ChatMessage>[]) =>
    parts.filter(
      part => part.type === 'data-editing' || part.type === 'data-finish'
    );

  it('tells the canvas which artifact a change is being written to', async () => {
    inDatabase(earlier('old', 'one two'));
    const r = reply();
    const update = r.tools.update_artifact;

    // Cut short, the id is not yet the artifact's.
    await written(update, 'edit1', '{"id":"ol');
    expect(r.parts).toEqual([]);
    const options = await written(update, 'edit2', '{"id":"old","oldStr"');
    expect(r.parts).toEqual([{ type: 'data-editing', data: { id: 'old' } }]);

    const { id } = (await update.execute(
      { id: 'old', oldStr: 'one', newStr: 'ONE' },
      options
    )) as { id: string };
    r.discardUnfinished();
    expect(r.kept()).toMatchObject([{ id, content: 'ONE two' }]);
    // The new version is written, and still being changed until the reply is
    // over — not just the step.
    expect(editing(r.parts)).toEqual([
      { type: 'data-editing', data: { id: 'old' } },
      { type: 'data-finish', data: { id } },
      { type: 'data-editing', data: { id } }
    ]);
  });

  it('shows later changes on the version the first made', async () => {
    inDatabase(earlier('old', 'one two'));
    const r = reply();
    const update = r.tools.update_artifact;

    const first = await written(update, 'edit1', '{"id":"old","oldStr"');
    const { id: copy } = (await update.execute(
      { id: 'old', oldStr: 'one', newStr: 'ONE' },
      first
    )) as { id: string };
    // The second names the earlier reply's artifact too.
    const second = await written(update, 'edit2', '{"id":"old","oldStr"');
    await update.execute({ id: 'old', oldStr: 'two', newStr: 'TWO' }, second);
    r.discardUnfinished();

    expect(editing(r.parts)).toEqual([
      { type: 'data-editing', data: { id: 'old' } },
      { type: 'data-finish', data: { id: copy } },
      { type: 'data-editing', data: { id: copy } },
      { type: 'data-editing', data: { id: copy } },
      { type: 'data-finish', data: { id: copy } },
      { type: 'data-editing', data: { id: copy } }
    ]);
    expect(r.kept()).toMatchObject([{ id: copy, content: 'ONE TWO' }]);
  });

  it('shows nothing done when a change cannot be made: the next call may', async () => {
    inDatabase(earlier('old', 'one two'));
    const r = reply();
    const update = r.tools.update_artifact;

    const options = await written(
      update,
      'edit1',
      '{"id":"old","oldStr":"nowhere"'
    );
    await expect(
      update.execute({ id: 'old', oldStr: 'nowhere', newStr: 'x' }, options)
    ).rejects.toThrow();
    r.discardUnfinished();
    expect(editing(r.parts)).toEqual([
      { type: 'data-editing', data: { id: 'old' } }
    ]);
  });

  it('changes the version the call names, though a newer one exists', async () => {
    // An earlier reply changed `first` into `newer`.
    inDatabase(earlier('first', 'one two'), {
      ...earlier('newer', 'one two three'),
      messageId: 'm9'
    });
    const r = reply();

    const { id } = await r.update('first', 'two', 'TWO');

    expect(r.kept()).toMatchObject([{ id, content: 'one TWO' }]);
  });

  it('makes one copy of an earlier reply’s artifact, changed by every call that follows the id it returned', async () => {
    const original = earlier('old', 'one two three');
    inDatabase(original);
    const r = reply();

    const first = await r.update('old', 'one', 'ONE');
    const second = await r.update(first.id, 'two', 'TWO');
    const third = await r.update(second.id, 'three', 'THREE');

    expect(new Set([first.id, second.id, third.id]).size).toBe(1);
    expect(r.kept()).toMatchObject([
      { id: first.id, content: 'ONE TWO THREE', messageId: 'm1' }
    ]);
    expect(original.content).toBe('one two three');
  });

  it('changes the same copy when every call names the earlier reply’s id', async () => {
    inDatabase(earlier('old', 'one two three'));
    const r = reply();

    await r.update('old', 'one', 'ONE');
    await r.update('old', 'two', 'TWO');
    await r.update('old', 'three', 'THREE');

    expect(r.kept()).toMatchObject([{ content: 'ONE TWO THREE' }]);
  });

  it('takes calls made at once in turn, so none starts from the earlier reply’s artifact again', async () => {
    inDatabase(earlier('old', 'one two three'));
    const r = reply();

    const ids = await Promise.all([
      r.update('old', 'one', 'ONE'),
      r.update('old', 'two', 'TWO'),
      r.update('old', 'three', 'THREE')
    ]);

    expect(new Set(ids.map(result => result.id)).size).toBe(1);
    expect(r.kept()).toMatchObject([{ content: 'ONE TWO THREE' }]);
    expect(getArtifact).toHaveBeenCalledOnce();
  });

  it('changes what this reply made in place, keeping its id and when it was made', async () => {
    const r = reply();
    const made = await r.create({
      title: 'Notes',
      type: 'markdown',
      content: 'one two'
    });
    const [{ createdAt }] = r.kept();

    const changed = await r.update(made.id, 'two', 'TWO');

    expect(changed.id).toBe(made.id);
    expect(r.kept()).toMatchObject([
      { id: made.id, content: 'one TWO', createdAt }
    ]);
    expect(getArtifact).not.toHaveBeenCalled();
  });

  it('makes a copy of each earlier artifact it changes', async () => {
    inDatabase(earlier('counter', 'count'), earlier('timer', 'time'));
    const r = reply();

    await Promise.all([
      r.update('counter', 'count', 'count, reset'),
      r.update('timer', 'time', 'time, lap'),
      r.update('timer', 'lap', 'lap, clear')
    ]);

    expect(r.kept()).toMatchObject([
      { title: 'counter', content: 'count, reset' },
      { title: 'timer', content: 'time, lap, clear' }
    ]);
  });

  it('keeps nothing of a call that fails, and goes on to the next', async () => {
    inDatabase(earlier('old', 'one two'));
    const r = reply();

    const [failed, done] = await Promise.allSettled([
      r.update('old', 'missing', 'x'),
      r.update('old', 'two', 'TWO')
    ]);

    expect(failed.status).toBe('rejected');
    expect(done.status).toBe('fulfilled');
    expect(r.kept()).toMatchObject([{ content: 'one TWO' }]);
  });

  it('refuses an artifact of another chat', async () => {
    inDatabase(earlier('elsewhere', 'one', 'c2'));
    const r = reply();

    await expect(r.update('elsewhere', 'one', 'ONE')).rejects.toThrow(
      'No artifact in this chat has id elsewhere'
    );
    expect(r.kept()).toEqual([]);
  });

  it('takes back from the canvas an artifact that streamed onto it and was not kept', async () => {
    const r = reply();
    const create = r.tools.create_artifact;
    const streaming = call('streamed');
    const input = {
      title: 'Broken',
      type: 'code' as const,
      language: 'tsx',
      fileName: 'index.tsx',
      content: 'export default function App() {\n  return <div>;\n}\n'
    };

    await create.onInputStart!(streaming);
    await create.onInputDelta!({
      ...streaming,
      inputTextDelta: JSON.stringify(input)
    });
    const streamed = r.parts.find(part => part.type === 'data-id');
    await expect(create.execute(input, streaming)).rejects.toThrow(
      'did not compile'
    );
    r.discardUnfinished();

    expect(r.kept()).toEqual([]);
    expect(r.parts.at(-1)).toEqual({
      type: 'data-discard',
      data: { id: streamed && 'data' in streamed ? streamed.data : undefined }
    });
  });
});
