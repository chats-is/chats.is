import { describe, expect, it } from 'vitest';

import { allowsModel, describeModelList } from './model-access';

describe('allowsModel', () => {
  it('with an empty list, allows every model either way', () => {
    expect(
      allowsModel({ modelRestrictionMode: 'allow', modelIds: [] }, 'a')
    ).toBe(true);
    expect(
      allowsModel({ modelRestrictionMode: 'deny', modelIds: [] }, 'a')
    ).toBe(true);
  });

  it('in allow mode, allows the listed models only', () => {
    const tier = { modelRestrictionMode: 'allow' as const, modelIds: ['a'] };
    expect(allowsModel(tier, 'a')).toBe(true);
    expect(allowsModel(tier, 'b')).toBe(false);
  });

  it('in deny mode, allows every model but the listed', () => {
    const tier = { modelRestrictionMode: 'deny' as const, modelIds: ['a'] };
    expect(allowsModel(tier, 'a')).toBe(false);
    expect(allowsModel(tier, 'b')).toBe(true);
  });
});

describe('describeModelList', () => {
  it('says how many, and which way', () => {
    expect(
      describeModelList({ modelRestrictionMode: 'allow', modelIds: [] })
    ).toBe('All');
    expect(
      describeModelList({ modelRestrictionMode: 'allow', modelIds: ['a', 'b'] })
    ).toBe('2 allowed');
    expect(
      describeModelList({ modelRestrictionMode: 'deny', modelIds: ['a'] })
    ).toBe('1 blocked');
  });
});
