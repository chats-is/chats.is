import { describe, expect, it } from 'vitest';

import {
  formatNumber,
  formatUsd,
  parseNumber,
  reportWindowStart
} from './utils';

describe('parseNumber', () => {
  it('returns null for nullish/empty', () => {
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('parses numeric strings (drizzle numeric columns)', () => {
    expect(parseNumber('0.0000001')).toBe(0.0000001);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('0')).toBe(0);
  });

  it('passes through numbers', () => {
    expect(parseNumber(42)).toBe(42);
    expect(parseNumber(0)).toBe(0);
  });

  it('returns null for non-finite / non-numeric', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber(Infinity)).toBeNull();
    expect(parseNumber(NaN)).toBeNull();
  });
});

describe('formatNumber', () => {
  it('adds locale thousands separators', () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(1000000)).toBe('1,000,000');
    expect(formatNumber(0)).toBe('0');
  });
});

describe('formatUsd', () => {
  it('preserves full precision and trims trailing zeros', () => {
    // Regression: cost/price must never silently truncate (numeric(20,10)).
    expect(formatUsd(0.08604231)).toBe('$0.08604231');
    expect(formatUsd(12.5)).toBe('$12.5');
    expect(formatUsd(0)).toBe('$0');
  });

  it('accepts numeric strings', () => {
    expect(formatUsd('0.0000001')).toBe('$0.0000001');
    expect(formatUsd('3')).toBe('$3');
  });

  it('falls back to $0 for invalid input', () => {
    expect(formatUsd(null)).toBe('$0');
    expect(formatUsd(undefined)).toBe('$0');
    expect(formatUsd('abc')).toBe('$0');
  });
});

describe('reportWindowStart', () => {
  it('days=1 → today local 00:00', () => {
    const start = reportWindowStart(1);
    const now = new Date();
    expect(start.getFullYear()).toBe(now.getFullYear());
    expect(start.getMonth()).toBe(now.getMonth());
    expect(start.getDate()).toBe(now.getDate());
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
  });

  it('days=7 → six local days ago at 00:00, spanning exactly 7 calendar days', () => {
    const start = reportWindowStart(7);
    const today0 = reportWindowStart(1);
    const diffDays = Math.round(
      (today0.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
    );
    expect(diffDays).toBe(6);
    expect(start.getHours()).toBe(0);
  });
});
