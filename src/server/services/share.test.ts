import { makeTestDb } from '@/test-utils/pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/db/schema';

const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/db', () => ({
  get db() {
    return h.db;
  }
}));
vi.mock('@/lib/env', () => ({ env: {} }));

const { getSharedArtifact } = await import('./share');

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
