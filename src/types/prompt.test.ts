/**
 * Note what this file does not do: it mocks nothing. These schemas carry no
 * database, environment or key dependency, which is why the console's prompt
 * form can import the same rules the server validates with.
 */
import { describe, expect, it } from 'vitest';

import { promptCreateSchema, promptUpdateSchema } from './prompt';

describe('prompt', () => {
  it('defaults the order, and rejects an empty edit', () => {
    expect(
      promptCreateSchema.parse({ name: 'n', content: 'c' }).displayOrder
    ).toBe(0);
    expect(promptUpdateSchema.safeParse({ id: 'i', content: '' }).success).toBe(
      false
    );
  });

  /**
   * Visibility is decided by which server function was called — the console
   * writes public prompts, a user writes private ones — so neither form offers
   * it and neither schema carries it. A client that sends one anyway is not
   * rejected; it is simply not listened to, which is what keeps the rule in one
   * place instead of two.
   */
  it('does not carry visibility, and drops one that is sent', () => {
    const parsed = promptCreateSchema.parse({
      name: 'n',
      content: 'c',
      visibility: 'public'
    });

    expect(parsed).not.toHaveProperty('visibility');
    expect(
      promptUpdateSchema.parse({ id: 'i', visibility: 'public' })
    ).not.toHaveProperty('visibility');
  });

  /** The console form must not accept what the server will reject. */
  it('caps a name at 100 and an image at 500', () => {
    const base = { name: 'n', content: 'c' };
    expect(
      promptCreateSchema.safeParse({ ...base, name: 'a'.repeat(101) }).success
    ).toBe(false);
    expect(
      promptCreateSchema.safeParse({ ...base, image: 'd'.repeat(501) }).success
    ).toBe(false);
  });
});
