import { describe, expect, it } from 'vitest';

import {
  applyMultiplier,
  describeMultiplier,
  effectiveMultiplier
} from './billing';

describe('effectiveMultiplier', () => {
  it('is the cost price — 1 — when unset, blank, 0 or below', () => {
    expect(effectiveMultiplier(null)).toBe(1);
    expect(effectiveMultiplier(undefined)).toBe(1);
    expect(effectiveMultiplier('')).toBe(1);
    expect(effectiveMultiplier('0')).toBe(1);
    expect(effectiveMultiplier(0)).toBe(1);
    expect(effectiveMultiplier('-2')).toBe(1);
    expect(effectiveMultiplier('abc')).toBe(1);
  });

  it('is the value when it is above 0, a markup or a discount', () => {
    expect(effectiveMultiplier('1.5')).toBe(1.5);
    expect(effectiveMultiplier(0.8)).toBe(0.8);
    expect(effectiveMultiplier('1.0000')).toBe(1);
  });
});

describe('applyMultiplier', () => {
  it('charges the cost price times the multiplier, to ten places', () => {
    expect(applyMultiplier(0.0028, 1.5)).toBe(0.0042);
    expect(applyMultiplier(0.1, 1)).toBe(0.1);
    expect(applyMultiplier(0.0000000001, 0.8)).toBe(0.0000000001);
  });
});

describe('describeMultiplier', () => {
  it('names the cost price where none is set, else the multiple — 1 included', () => {
    expect(describeMultiplier(null)).toBe('Cost price');
    expect(describeMultiplier('')).toBe('Cost price');
    expect(describeMultiplier('0')).toBe('Cost price');
    expect(describeMultiplier('1.0000')).toBe('× 1');
    expect(describeMultiplier('1.5000')).toBe('× 1.5');
  });
});
