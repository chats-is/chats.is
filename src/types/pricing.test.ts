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
