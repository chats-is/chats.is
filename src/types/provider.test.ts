/**
 * Note what this file does not do: it mocks nothing. These schemas carry no
 * database, environment or key dependency, which is why the console's provider
 * form can import the same rules the server validates with.
 */
import { describe, expect, it } from 'vitest';

import { providerCreateSchema, providerUpdateSchema } from './provider';

describe('provider', () => {
  it('only accepts the eight known types', () => {
    expect(
      providerCreateSchema.safeParse({ name: 'P', type: 'nope', apiKey: 'k' })
        .success
    ).toBe(false);
  });

  it('takes a URL or an empty string as baseUrl, nothing else', () => {
    expect(
      providerCreateSchema.safeParse({
        name: 'P',
        type: 'openai',
        apiKey: 'k',
        baseUrl: ''
      }).success
    ).toBe(true);
    expect(
      providerCreateSchema.safeParse({
        name: 'P',
        type: 'openai',
        apiKey: 'k',
        baseUrl: 'nope'
      }).success
    ).toBe(false);
  });

  it('allows clearing apiOptions on update but not on create', () => {
    expect(
      providerUpdateSchema.safeParse({
        id: 'i',
        type: 'openai',
        apiOptions: null
      }).success
    ).toBe(true);
    expect(
      providerCreateSchema.safeParse({
        name: 'P',
        type: 'openai',
        apiKey: 'k',
        apiOptions: null
      }).success
    ).toBe(false);
  });

  it('defaults a new provider to disabled, order 0', () => {
    const r = providerCreateSchema.parse({
      name: 'P',
      type: 'openai',
      apiKey: 'k'
    });
    expect(r.isEnabled).toBe(false);
    expect(r.displayOrder).toBe(0);
  });
});
