/**
 * Note what this file does not do: it mocks nothing. These schemas carry no
 * database, environment or key dependency, which is why the console's prompt
 * form can import the same rules the server validates with.
 */
import { describe, expect, it } from 'vitest';

import { promptCreateSchema, promptUpdateSchema } from './prompt';

describe('prompt', () => {
  it('only accepts private or public visibility, and defaults the order', () => {
    expect(
      promptCreateSchema.safeParse({ name: 'n', content: 'c', visibility: 'x' })
        .success
    ).toBe(false);
    expect(
      promptCreateSchema.parse({ name: 'n', content: 'c' }).displayOrder
    ).toBe(0);
    expect(promptUpdateSchema.safeParse({ id: 'i', content: '' }).success).toBe(
      false
    );
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
