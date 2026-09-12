/**
 * The input schemas the server functions validate with.
 *
 * They live under `src/types` so the console forms can hold themselves to the
 * same rules — a form that lets through what the server rejects is a round
 * trip the user pays for and a message they did not expect. The forms cannot
 * share the schemas wholesale (a form field is a string where a column is a
 * number, and the forms carry UI-only fields of their own), so what is shared
 * is the field-level constraint, and these tests are what keep the two honest.
 *
 * Note what this file does not do: it mocks nothing. These schemas carry no
 * database, environment or key dependency, which is why a component may
 * import them.
 */
import { describe, expect, it } from 'vitest';

import {
  modelCapabilitySchema,
  modelCreateSchema,
  modelUpdateSchema
} from './model';
import { planCreateSchema } from './plan';
import {
  pricingUpsertSchema,
  remoteSearchSchema,
  syncRunSchema,
  syncTargetSchema
} from './pricing';
import { promptCreateSchema, promptUpdateSchema } from './prompt';
import { providerCreateSchema, providerUpdateSchema } from './provider';
import {
  quotaCreateSchema,
  quotaUpdateSchema,
  validateQuotaLimits
} from './quota';
import { settingSchema } from './settings';

const baseModel = {
  name: 'M',
  modelId: 'm-1',
  capability: 'chat' as const,
  providers: [{ providerId: 'p1' }]
};

describe('model', () => {
  it('rejects unknown uiOptions keys on both writes', () => {
    expect(
      modelCreateSchema.safeParse({ ...baseModel, uiOptions: { bogus: 1 } })
        .success
    ).toBe(false);
    expect(
      modelUpdateSchema.safeParse({ id: 'x', uiOptions: { bogus: 1 } }).success
    ).toBe(false);
  });

  it('rejects unknown apiParams keys on both writes', () => {
    expect(
      modelCreateSchema.safeParse({ ...baseModel, apiParams: { bogus: 1 } })
        .success
    ).toBe(false);
    expect(
      modelUpdateSchema.safeParse({ id: 'x', apiParams: { bogus: 1 } }).success
    ).toBe(false);
  });

  it('allows clearing the option objects on update but not on create', () => {
    expect(
      modelUpdateSchema.safeParse({ id: 'x', uiOptions: null }).success
    ).toBe(true);
    expect(
      modelCreateSchema.safeParse({ ...baseModel, uiOptions: null }).success
    ).toBe(false);
  });

  it('requires a non-empty providerId in every binding', () => {
    expect(
      modelCreateSchema.safeParse({
        ...baseModel,
        providers: [{ providerId: '' }]
      }).success
    ).toBe(false);
    expect(
      modelUpdateSchema.safeParse({ id: 'x', providers: [{ providerId: '' }] })
        .success
    ).toBe(false);
  });

  it('requires binding priority to be an integer', () => {
    expect(
      modelCreateSchema.safeParse({
        ...baseModel,
        providers: [{ providerId: 'p1', priority: 1.5 }]
      }).success
    ).toBe(false);
  });

  it('defaults every capability flag off, except isEnabled', () => {
    const r = modelCreateSchema.parse(baseModel);
    expect(r.supportsVision).toBe(false);
    expect(r.supportsReasoning).toBe(false);
    expect(r.supportsImageEdit).toBe(false);
    expect(r.supportsImageToVideo).toBe(false);
    expect(r.supportsVideoEdit).toBe(false);
    expect(r.supportsTranscription).toBe(false);
    expect(r.isEnabled).toBe(true);
    expect(r.displayOrder).toBe(0);
  });

  it('only accepts an effort from the shared vocabulary', () => {
    expect(
      modelCreateSchema.safeParse({
        ...baseModel,
        uiOptions: { effort: 'nope' }
      }).success
    ).toBe(false);
  });

  it('is the one list of capabilities', () => {
    expect(modelCapabilitySchema.options).toEqual([
      'chat',
      'image',
      'video',
      'audio'
    ]);
  });
});

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

describe('quota', () => {
  it('takes a positive number, an empty string, or null as a limit', () => {
    expect(
      quotaCreateSchema.safeParse({ name: 'q', fiveHour: 5 }).success
    ).toBe(true);
    expect(
      quotaCreateSchema.safeParse({ name: 'q', fiveHour: '' }).success
    ).toBe(true);
    expect(
      quotaCreateSchema.safeParse({ name: 'q', fiveHour: null }).success
    ).toBe(true);
    expect(
      quotaCreateSchema.safeParse({ name: 'q', fiveHour: -1 }).success
    ).toBe(false);
  });

  it('defaults a new quota to no limits and no model restriction', () => {
    const r = quotaCreateSchema.parse({ name: 'q' });
    expect(r.fiveHour).toBeNull();
    expect(r.sevenDay).toBeNull();
    expect(r.isUnlimited).toBe(false);
    expect(r.allowedModelIds).toEqual([]);
  });

  it('leaves limits absent on update rather than defaulting them', () => {
    expect('fiveHour' in quotaUpdateSchema.parse({ id: 'i' })).toBe(false);
  });

  it('holds the 5-hour limit to a quarter of the weekly one', () => {
    expect(() =>
      validateQuotaLimits({ fiveHour: 25, sevenDay: 100 })
    ).not.toThrow();
    expect(() => validateQuotaLimits({ fiveHour: 26, sevenDay: 100 })).toThrow(
      /25% of weekly/
    );
    expect(() =>
      validateQuotaLimits({ fiveHour: 999, sevenDay: null })
    ).not.toThrow();
    expect(() =>
      validateQuotaLimits({ fiveHour: null, sevenDay: 100 })
    ).not.toThrow();
  });
});

describe('pricing', () => {
  it('normalises every price to a decimal string or null', () => {
    const r = pricingUpsertSchema.parse({
      modelDbId: 'm',
      input: 3,
      output: '15',
      image: '',
      video: -1
    });
    expect(r.input).toBe('3');
    expect(r.output).toBe('15');
    expect(r.image).toBeNull();
    expect(r.video).toBeNull();
    expect(r.source).toBe('manual');
  });

  it('defaults onlyMissing to false, and keeps it off the preview shape', () => {
    expect(syncRunSchema.parse({ source: 'models.dev' }).onlyMissing).toBe(
      false
    );
    expect(
      'onlyMissing' in syncTargetSchema.parse({ source: 'models.dev' })
    ).toBe(false);
  });

  it('defaults the remote search to 50 results and caps it at 200', () => {
    expect(remoteSearchSchema.parse({ source: 'models.dev' }).limit).toBe(50);
    expect(
      remoteSearchSchema.safeParse({ source: 'models.dev', limit: 201 }).success
    ).toBe(false);
  });
});

describe('prompt and setting', () => {
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

  it('bounds a setting key and description', () => {
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

/**
 * The console forms are shaped for the form, not for the column, so they
 * cannot reuse these schemas outright. What they must not do is disagree
 * about a limit — a form that accepts 200 characters where the server accepts
 * 100 sends the user on a round trip to be told no.
 */
describe('the console forms hold to the same field limits', () => {
  const tooLongName = 'a'.repeat(101);
  const tooLongText = 'd'.repeat(501);

  it('caps a model name at 100 and a model id at 255', () => {
    expect(
      modelCreateSchema.safeParse({ ...baseModel, name: tooLongName }).success
    ).toBe(false);
    expect(
      modelCreateSchema.safeParse({ ...baseModel, modelId: 'm'.repeat(256) })
        .success
    ).toBe(false);
  });

  it('caps a plan name at 100 and its description at 500', () => {
    const base = { name: 'p', quotaId: 'q' };
    expect(
      planCreateSchema.safeParse({ ...base, name: tooLongName }).success
    ).toBe(false);
    expect(
      planCreateSchema.safeParse({ ...base, description: tooLongText }).success
    ).toBe(false);
  });

  it('caps a quota name at 100 and its description at 500', () => {
    expect(quotaCreateSchema.safeParse({ name: tooLongName }).success).toBe(
      false
    );
    expect(
      quotaCreateSchema.safeParse({ name: 'q', description: tooLongText })
        .success
    ).toBe(false);
  });

  it('caps a prompt name at 100 and its image at 500', () => {
    const base = { name: 'n', content: 'c' };
    expect(
      promptCreateSchema.safeParse({ ...base, name: tooLongName }).success
    ).toBe(false);
    expect(
      promptCreateSchema.safeParse({ ...base, image: tooLongText }).success
    ).toBe(false);
  });
});
