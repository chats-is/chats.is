import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getUserResolvedQuota, getUserUsageWindows } from '@/lib/queries';

import {
  assertModelAccess,
  assertQuota,
  getUserQuota,
  ModelAccessDeniedError,
  QuotaExceededError,
  validateQuotaLimits
} from './quota';

// quota.ts is the business layer over the DB-access layer (`@/lib/queries`).
// Mock queries so we test the resolve/percent/threshold logic in isolation.
vi.mock('@/lib/queries', () => ({
  getUserResolvedQuota: vi.fn(),
  getUserUsageWindows: vi.fn()
}));

const mockResolved = vi.mocked(getUserResolvedQuota);
const mockWindows = vi.mocked(getUserUsageWindows);

/** Build the resolved-quota shape `getUserResolvedQuota` returns. */
function resolved(
  quota: Record<string, unknown> | null,
  source = 'override',
  plan: { id: string; name: string } | null = null
) {
  return { quota, source, plan } as never;
}

function windows(fiveUsed: number, sevenUsed: number) {
  return {
    fiveHour: { used: fiveUsed, resetAt: new Date('2026-01-01T05:00:00Z') },
    sevenDay: { used: sevenUsed, resetAt: new Date('2026-01-07T00:00:00Z') }
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateQuotaLimits (pure)', () => {
  it('passes when 5-hour ≤ 25% of weekly', () => {
    expect(() =>
      validateQuotaLimits({ fiveHour: 25, sevenDay: 100 })
    ).not.toThrow();
  });

  it('throws when 5-hour exceeds 25% of weekly', () => {
    expect(() => validateQuotaLimits({ fiveHour: 26, sevenDay: 100 })).toThrow(
      /25% of weekly/
    );
  });

  it('ignores the check when either side is null', () => {
    expect(() =>
      validateQuotaLimits({ fiveHour: 999, sevenDay: null })
    ).not.toThrow();
    expect(() =>
      validateQuotaLimits({ fiveHour: null, sevenDay: 100 })
    ).not.toThrow();
  });
});

describe('getUserQuota', () => {
  it('source=none (no quota set) → free, no usage query made', async () => {
    mockResolved.mockResolvedValue(resolved(null, 'none'));

    const out = await getUserQuota('u1');

    expect(mockWindows).not.toHaveBeenCalled();
    expect(out).toEqual({
      name: null,
      isUnlimited: false,
      source: 'none',
      plan: null
    });
    // Never leaks dollar caps.
    expect(out).not.toHaveProperty('fiveHour.cap');
  });

  it('computes remainingPct from usage windows and never exposes dollars', async () => {
    mockResolved.mockResolvedValue(
      resolved({
        name: 'Pro',
        isUnlimited: false,
        allowedModelIds: [],
        fiveHour: '10',
        sevenDay: '100'
      })
    );
    mockWindows.mockResolvedValue(windows(2.5, 40));

    const out = await getUserQuota('u1');

    // 5h: (10-2.5)/10 = 75%; 7d: (100-40)/100 = 60%
    expect(out.fiveHour?.remainingPct).toBe(75);
    expect(out.sevenDay?.remainingPct).toBe(60);
    expect(out.fiveHour?.resetAt).toEqual(new Date('2026-01-01T05:00:00Z'));
    // No raw caps / used amounts in the output.
    expect(JSON.stringify(out)).not.toContain('"used"');
    expect(JSON.stringify(out)).not.toContain('"cap"');
  });

  it('clamps remainingPct at 0 when usage exceeds cap', async () => {
    mockResolved.mockResolvedValue(
      resolved({
        name: 'Pro',
        isUnlimited: false,
        allowedModelIds: [],
        fiveHour: '10',
        sevenDay: null
      })
    );
    mockWindows.mockResolvedValue(windows(25, 0));

    const out = await getUserQuota('u1');
    expect(out.fiveHour?.remainingPct).toBe(0);
    expect(out.sevenDay).toBeUndefined();
  });
});

describe('assertQuota', () => {
  it('returns immediately for unlimited quota (no usage query)', async () => {
    mockResolved.mockResolvedValue(
      resolved({
        isUnlimited: true,
        allowedModelIds: [],
        fiveHour: null,
        sevenDay: null
      })
    );
    await expect(assertQuota('u1')).resolves.toBeUndefined();
    expect(mockWindows).not.toHaveBeenCalled();
  });

  it('returns when no caps are configured (free use)', async () => {
    mockResolved.mockResolvedValue(resolved(null, 'none'));
    await expect(assertQuota('u1')).resolves.toBeUndefined();
    expect(mockWindows).not.toHaveBeenCalled();
  });

  it('throws QuotaExceededError when 5-hour usage reaches the cap', async () => {
    mockResolved.mockResolvedValue(
      resolved({
        isUnlimited: false,
        allowedModelIds: [],
        fiveHour: '10',
        sevenDay: '100'
      })
    );
    mockWindows.mockResolvedValue(windows(10, 0));

    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(assertQuota('u1')).rejects.toMatchObject({
      resetAt: new Date('2026-01-01T05:00:00Z')
    });
  });

  it('throws on weekly cap when 5-hour is under but weekly is reached', async () => {
    mockResolved.mockResolvedValue(
      resolved({
        isUnlimited: false,
        allowedModelIds: [],
        fiveHour: '10',
        sevenDay: '100'
      })
    );
    mockWindows.mockResolvedValue(windows(1, 100));

    await expect(assertQuota('u1')).rejects.toMatchObject({
      resetAt: new Date('2026-01-07T00:00:00Z')
    });
  });

  it('does not throw when usage is below both caps', async () => {
    mockResolved.mockResolvedValue(
      resolved({
        isUnlimited: false,
        allowedModelIds: [],
        fiveHour: '10',
        sevenDay: '100'
      })
    );
    mockWindows.mockResolvedValue(windows(9.99, 99));
    await expect(assertQuota('u1')).resolves.toBeUndefined();
  });
});

describe('assertModelAccess', () => {
  it('allows any model when allowedModelIds is empty (no restriction)', async () => {
    mockResolved.mockResolvedValue(resolved({ allowedModelIds: [] }));
    await expect(
      assertModelAccess('u1', 'gpt-4o', 'GPT-4o')
    ).resolves.toBeUndefined();
  });

  it('allows a model in the allowlist', async () => {
    mockResolved.mockResolvedValue(resolved({ allowedModelIds: ['gpt-4o'] }));
    await expect(
      assertModelAccess('u1', 'gpt-4o', 'GPT-4o')
    ).resolves.toBeUndefined();
  });

  it('denies a model not in the allowlist', async () => {
    mockResolved.mockResolvedValue(resolved({ allowedModelIds: ['gpt-4o'] }));
    await expect(
      assertModelAccess('u1', 'claude-opus', 'Claude Opus')
    ).rejects.toBeInstanceOf(ModelAccessDeniedError);
  });
});
