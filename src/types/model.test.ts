/**
 * Note what this file does not do: it mocks nothing. These schemas carry no
 * database, environment or key dependency, which is why the console's model
 * form can import the same rules the server validates with.
 */
import { describe, expect, it } from 'vitest';

import {
  modelCapabilitySchema,
  modelCreateSchema,
  modelUpdateSchema
} from './model';

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

  /**
   * The console form is shaped for the form, not the column, so it cannot
   * reuse this schema outright. What it must not do is disagree about a
   * limit — a form accepting 200 characters where the server accepts 100
   * sends the user on a round trip to be told no.
   */
  it('caps a name at 100 and a model id at 255', () => {
    expect(
      modelCreateSchema.safeParse({ ...baseModel, name: 'a'.repeat(101) })
        .success
    ).toBe(false);
    expect(
      modelCreateSchema.safeParse({ ...baseModel, modelId: 'm'.repeat(256) })
        .success
    ).toBe(false);
  });
});
