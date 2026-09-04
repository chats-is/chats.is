import { describe, expect, it } from 'vitest';

import { expand, readPath } from './values';

/**
 * A setting key is a dotted path, and the form addresses nested fields by the
 * same notation — so the keys are expanded on the way in and read back on the
 * way out. If the two ever disagree, a save writes empty values over real
 * settings without saying so, which is what these guard.
 */

const KEYS = [
  'app.name',
  'app.subtitle',
  'app.description',
  'default.chat.modelId',
  'default.chat.systemPrompt',
  'default.video.imageModelId',
  'default.quotaId',
  'speech.enabled',
  'title.modelId'
];

describe('expand', () => {
  it('nests a dotted key', () => {
    expect(expand({ 'app.name': 'Acme' })).toEqual({ app: { name: 'Acme' } });
  });

  it('gathers keys that share a prefix', () => {
    expect(expand({ 'app.name': 'Acme', 'app.subtitle': 'Chat' })).toEqual({
      app: { name: 'Acme', subtitle: 'Chat' }
    });
  });

  it('lets a branch and a leaf share a parent', () => {
    // `default.chat.modelId` makes `default.chat` an object while
    // `default.quotaId` puts a string beside it.
    expect(
      expand({ 'default.chat.modelId': 'gpt', 'default.quotaId': 'q1' })
    ).toEqual({ default: { chat: { modelId: 'gpt' }, quotaId: 'q1' } });
  });
});

describe('readPath', () => {
  it('reads every key back out of what expand built', () => {
    const flat = Object.fromEntries(KEYS.map(key => [key, `value:${key}`]));
    const nested = expand(flat);

    for (const key of KEYS) {
      expect(readPath(nested, key)).toBe(`value:${key}`);
    }
  });

  it('is empty for a key the form never held', () => {
    expect(readPath(expand({ 'app.name': 'Acme' }), 'app.subtitle')).toBe('');
    expect(readPath({}, 'default.chat.modelId')).toBe('');
  });

  it('is empty rather than an object when a key names a branch', () => {
    // Guards the save path: a branch must never be sent as a setting value.
    expect(readPath(expand({ 'app.name': 'Acme' }), 'app')).toBe('');
  });
});
