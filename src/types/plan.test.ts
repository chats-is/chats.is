/**
 * Note what this file does not do: it mocks nothing. These schemas carry no
 * database, environment or key dependency, which is why the console's plan
 * form can import the same rules the server validates with.
 */
import { describe, expect, it } from 'vitest';

import { planCreateSchema } from './plan';

describe('plan', () => {
  /** The console form must not accept a name or description the server will
   *  reject; that is a round trip the user pays for. */
  it('caps a name at 100 and a description at 500', () => {
    const base = { name: 'p', quotaId: 'q' };
    expect(
      planCreateSchema.safeParse({ ...base, name: 'a'.repeat(101) }).success
    ).toBe(false);
    expect(
      planCreateSchema.safeParse({ ...base, description: 'd'.repeat(501) })
        .success
    ).toBe(false);
  });
});
