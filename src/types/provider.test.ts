/**
 * Note what this file does not do: it mocks nothing. These schemas carry no
 * database, environment or key dependency, which is why the console's provider
 * form can import the same rules the server validates with.
 */
import { describe, expect, it } from 'vitest';

import {
  apiOptionsError,
  providerCreateSchema,
  providerUpdateSchema
} from './provider';

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

  it('takes the options of any call a provider is used for', () => {
    // An image option and a chat option, side by side on one provider.
    expect(
      apiOptionsError('openai', { quality: 'max', reasoningSummary: 'auto' })
    ).toBeUndefined();
    expect(
      apiOptionsError('anthropic', {
        thinking: { type: 'enabled', budgetTokens: 1024 }
      })
    ).toBeUndefined();
    expect(apiOptionsError('azure', { apiVersion: 'preview' })).toBeUndefined();
  });

  it('names a key that no call of the provider takes', () => {
    expect(apiOptionsError('openai', { qualty: 'max' })).toBe(
      'Unknown option "qualty" for OpenAI'
    );
    expect(apiOptionsError('deepseek', { quality: 'max' })).toBe(
      'Unknown option "quality" for DeepSeek'
    );
    expect(apiOptionsError('openai', { apiVersion: 'preview' })).toBe(
      'Unknown option "apiVersion" for OpenAI'
    );
  });

  it('names a value the option does not take, down to the nested key', () => {
    expect(apiOptionsError('openai', { quality: 'ultra' })).toMatch(
      /^quality: /
    );
    expect(
      apiOptionsError('anthropic', { thinking: { type: 'enabled', budget: 1 } })
    ).toMatch(/^thinking: /);
    expect(
      apiOptionsError('anthropic', {
        cacheControl: { type: 'ephemeral', ttl: '2h' }
      })
    ).toMatch(/^cacheControl\.ttl: /);
  });

  it('refuses options the provider would not take, on create and update', () => {
    const created = providerCreateSchema.safeParse({
      name: 'P',
      type: 'openai',
      apiKey: 'k',
      apiOptions: { qualty: 'max' }
    });
    expect(created.error?.issues[0]).toMatchObject({
      path: ['apiOptions'],
      message: 'Unknown option "qualty" for OpenAI'
    });
    expect(
      providerUpdateSchema.safeParse({
        id: 'i',
        type: 'openai',
        apiOptions: { quality: 'ultra' }
      }).success
    ).toBe(false);
  });
});
