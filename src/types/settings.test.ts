/**
 * Note what this file does not do: it mocks nothing. These schemas carry no
 * database, environment or key dependency, which is why a form can import the
 * same rules the server validates with.
 */
import { describe, expect, it } from 'vitest';

import { settingSchema } from './settings';

describe('setting', () => {
  it('bounds a key at 100 characters and a description at 500', () => {
    expect(
      settingSchema.safeParse({ key: 'a'.repeat(101), value: null }).success
    ).toBe(false);
    expect(
      settingSchema.safeParse({
        key: 'k',
        value: null,
        description: 'd'.repeat(501)
      }).success
    ).toBe(false);
    expect(settingSchema.safeParse({ key: 'k', value: null }).success).toBe(
      true
    );
  });
});
