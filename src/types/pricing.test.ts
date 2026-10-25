/**
 * Note what this file does not do: it mocks nothing. These schemas carry no
 * database, environment or key dependency, which is why the console's pricing
 * form can import the same rules the server validates with.
 */
import { describe, expect, it } from 'vitest';

import {
  pricingUpsertSchema,
  remoteSearchSchema,
  syncRunSchema,
  syncTargetSchema
} from './pricing';

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

  it('keeps the rates by resolution that are set, and none as null', () => {
    expect(
      pricingUpsertSchema.parse({
        modelDbId: 'm',
        resolutionPrices: { '720p': '0.1', '1080p': '', '4k': 0.4 }
      }).resolutionPrices
    ).toEqual({ '720p': '0.1', '4k': '0.4' });
    expect(
      pricingUpsertSchema.parse({
        modelDbId: 'm',
        resolutionPrices: { '720p': '' }
      }).resolutionPrices
    ).toBeNull();
    expect(
      pricingUpsertSchema.parse({ modelDbId: 'm' }).resolutionPrices
    ).toBeNull();
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
