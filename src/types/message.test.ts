import { describe, expect, it } from 'vitest';

import { userMessageSchema } from './message';

const message = (parts: unknown[]) => ({ id: 'm1', role: 'user', parts });

describe('userMessageSchema', () => {
  it("takes a preview's error with whose preview it came from", () => {
    expect(
      userMessageSchema.safeParse(
        message([
          { type: 'text', text: 'undefinedThing is not defined' },
          { type: 'data-artifactRef', data: { id: 'a1' } }
        ])
      ).success
    ).toBe(true);
  });

  it('refuses any other data part', () => {
    expect(
      userMessageSchema.safeParse(
        message([
          { type: 'text', text: 'hi' },
          { type: 'data-error', data: { kind: 'x', message: 'y' } }
        ])
      ).success
    ).toBe(false);
  });

  it('refuses a preview error without an artifact', () => {
    expect(
      userMessageSchema.safeParse(
        message([
          { type: 'text', text: 'hi' },
          { type: 'data-artifactRef', data: { id: '' } }
        ])
      ).success
    ).toBe(false);
  });
});
