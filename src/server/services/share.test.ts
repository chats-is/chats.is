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
vi.mock('@/lib/env', () => ({ env: {} }));

const {
  createArtifactShare,
  deleteShare,
  getSharedArtifact,
  getSharedArtifactPage,
  getSharedChat,
  listShares
} = await import('./share');

let client: { close?: () => Promise<void> } | undefined;

beforeAll(async () => {
  const t = await makeTestDb();
  h.db = t.db;
  client = t.client;

  // Two people, a chat each, an artifact each, and one share link — of the
  // first chat only.
  await h.db.insert(schema.users).values([
    { id: 'owner', name: 'Owner', email: 'owner@example.com' },
    { id: 'other', name: 'Other', email: 'other@example.com' }
  ]);
  await h.db.insert(schema.chats).values([
    { id: 'shared-chat', title: 'Shared', userId: 'owner', modelId: 'm' },
    { id: 'private-chat', title: 'Private', userId: 'other', modelId: 'm' }
  ]);
  await h.db.insert(schema.messages).values([
    {
      id: 'm1',
      chatId: 'shared-chat',
      userId: 'owner',
      role: 'assistant',
      parts: []
    },
    {
      id: 'm2',
      chatId: 'private-chat',
      userId: 'other',
      role: 'assistant',
      parts: []
    }
  ]);
  await h.db.insert(schema.artifacts).values([
    {
      id: 'shared-artifact',
      chatId: 'shared-chat',
      messageId: 'm1',
      userId: 'owner',
      title: 'Counter',
      type: 'code',
      language: 'tsx',
      content: 'export default () => null'
    },
    {
      id: 'sibling-artifact',
      chatId: 'shared-chat',
      messageId: 'm1',
      userId: 'owner',
      title: 'Notes',
      type: 'markdown',
      content: '# Notes'
    },
    {
      id: 'private-artifact',
      chatId: 'private-chat',
      messageId: 'm2',
      userId: 'other',
      title: 'Secret',
      type: 'code',
      language: 'tsx',
      content: 'export default () => "secret"'
    }
  ]);
  await h.db
    .insert(schema.shares)
    .values({ id: 'link', chatId: 'shared-chat', userId: 'owner' });
});

afterAll(async () => {
  await client?.close?.();
});

describe('getSharedArtifact', () => {
  it('hands back an artifact of the chat the link opens', async () => {
    await expect(getSharedArtifact('link', 'shared-artifact')).resolves.toEqual(
      {
        id: 'shared-artifact',
        content: 'export default () => null'
      }
    );
  });

  it('answers nothing for an artifact of another chat', async () => {
    // The link is real and the artifact is real; they just do not go together.
    // A share link must not become a way to read anyone's artifacts by id.
    await expect(
      getSharedArtifact('link', 'private-artifact')
    ).resolves.toBeUndefined();
  });

  it('answers nothing for a link that does not exist', async () => {
    await expect(
      getSharedArtifact('no-such-link', 'shared-artifact')
    ).resolves.toBeUndefined();
  });
});

describe('an artifact shared on its own', () => {
  it('is shared once: sharing it again hands back the same link', async () => {
    const first = await createArtifactShare('owner', 'shared-artifact');
    const again = await createArtifactShare('owner', 'shared-artifact');

    expect(again.id).toBe(first.id);
  });

  it('cannot be shared by anyone but its owner', async () => {
    await expect(
      createArtifactShare('owner', 'private-artifact')
    ).rejects.toThrow('Artifact not found');
  });

  it('opens that artifact, and nothing of its chat', async () => {
    const { id } = await createArtifactShare('owner', 'shared-artifact');

    const page = await getSharedArtifactPage(id);
    expect(page).toMatchObject({ id: 'shared-artifact', title: 'Counter' });
    expect(page).not.toHaveProperty('chatId');
    expect(page).not.toHaveProperty('messageId');
    expect(page).not.toHaveProperty('userId');

    // Its id is no key to the chat page.
    await expect(getSharedChat(id)).resolves.toBeFalsy();
  });

  it("compiles that artifact's source alone, not its chat's others", async () => {
    const { id } = await createArtifactShare('owner', 'shared-artifact');

    await expect(getSharedArtifact(id, 'shared-artifact')).resolves.toEqual({
      id: 'shared-artifact',
      content: 'export default () => null'
    });
    await expect(
      getSharedArtifact(id, 'sibling-artifact')
    ).resolves.toBeUndefined();
  });

  it("is not opened by a chat's link", async () => {
    await expect(getSharedArtifactPage('link')).resolves.toBeUndefined();
    await expect(getSharedChat('link')).resolves.toMatchObject({
      id: 'shared-chat'
    });
  });

  it('is listed with the chats shared, by what it is', async () => {
    const { rows } = await listShares('owner', { page: 1, pageSize: 10 });

    expect(rows).toContainEqual(
      expect.objectContaining({
        artifact: { id: 'shared-artifact', title: 'Counter', type: 'code' }
      })
    );
    expect(rows).toContainEqual(
      expect.objectContaining({ id: 'link', artifact: null })
    );
  });

  it('goes with the artifact', async () => {
    const { id } = await createArtifactShare('owner', 'sibling-artifact');
    await h.db
      .delete(schema.artifacts)
      .where(eq(schema.artifacts.id, 'sibling-artifact'));

    await expect(getSharedArtifactPage(id)).resolves.toBeUndefined();
    const left = await h.db.query.shares.findFirst({
      where: eq(schema.shares.id, id)
    });
    expect(left).toBeUndefined();
  });

  it('is taken back like any link', async () => {
    const { id } = await createArtifactShare('owner', 'shared-artifact');
    await deleteShare('owner', id);

    await expect(getSharedArtifactPage(id)).resolves.toBeUndefined();
  });

  it('names a chat or an artifact, never both and never neither', async () => {
    await expect(
      h.db.insert(schema.shares).values({ id: 'neither', userId: 'owner' })
    ).rejects.toThrow();
    await expect(
      h.db.insert(schema.shares).values({
        id: 'both',
        chatId: 'private-chat',
        artifactId: 'private-artifact',
        userId: 'owner'
      })
    ).rejects.toThrow();
  });
});
