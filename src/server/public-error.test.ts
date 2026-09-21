import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { validationMessage } from './public-error';

/** What the framework throws when a validator refuses its input. */
const refusal = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input);
  if (result.success) throw new Error('expected a refusal');
  return new Error(JSON.stringify(result.error.issues, undefined, 2));
};

describe('validationMessage', () => {
  it('reads the first issue out of a refused input', () => {
    const schema = z.object({
      name: z.string().min(1, 'A name is required')
    });

    expect(validationMessage(refusal(schema, { name: '' }))).toBe(
      'A name is required'
    );
  });

  it('is not fooled by other errors, JSON or otherwise', () => {
    for (const error of [
      new Error('connect ECONNREFUSED 10.0.0.1:5432'),
      new Error('[object Object]'),
      new Error('[]'),
      new Error('[1, 2, 3]'),
      new Error('[{"message":"no path"}]'),
      'a string',
      null
    ]) {
      expect(validationMessage(error)).toBeUndefined();
    }
  });
});
