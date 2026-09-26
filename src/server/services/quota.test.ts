import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertQuota,
  getUserQuota,
  QuotaExceededError,
  QuotaMissingError
} from './quota';

/**
 * The reads and the rules live in one module, so the seam these tests work
 * against is the database itself rather than a neighbouring file: the two
 * queries run for real against the rows set up here. What is under test is
 * everything above them — which quota applies, what percentage is left, when
 * a cap has been reached, and that no dollar amount ever reaches the caller.
 */
const h = vi.hoisted(() => ({
  /** The row `db.query.users.findFirst` answers with. */
  userRow: undefined as Record<string, unknown> | undefined,
  /** The row `db.query.quotas.findFirst` answers with, for the default path. */
  defaultQuotaRow: undefined as Record<string, unknown> | undefined,
  /** The aggregate row the usage window query answers with. */
  usageAggregate: null as Record<string, unknown> | null,
  /** Whether the usage window query was reached at all. */
  usageQueried: false
}));

vi.mock('@/db', () => ({
  db: {
    query: {
      users: { findFirst: async () => h.userRow },
      quotas: { findFirst: async () => h.defaultQuotaRow }
    },
    select: () => ({
      from: () => ({
        where: async () => {
          h.usageQueried = true;
          return [h.usageAggregate];
        }
      })
    })
  }
}));

vi.mock('@/server/services/settings', () => ({
  getDefaultQuotaId: vi.fn(async () => null)
}));

const FIVE_HOUR_RESET = new Date('2026-01-01T05:00:00Z');
const SEVEN_DAY_RESET = new Date('2026-01-07T00:00:00Z');

/** Give the user a quota row, or none at all. */
function givenQuota(
  quota: Record<string, unknown> | null,
  plan: { id: string; name: string } | null = null
) {
  h.userRow = { quota, plan };
}

/**
 * Set what the window query sums to. The reset times are derived from the
 * oldest row in each window, so the fixtures work backwards from the two
 * instants the assertions name.
 */
function givenUsage(fiveUsed: number, sevenUsed: number) {
  h.usageAggregate = {
    sumFiveHour: String(fiveUsed),
    sumSevenDay: String(sevenUsed),
    minFiveHour: new Date(FIVE_HOUR_RESET.getTime() - 5 * 60 * 60 * 1000),
    minSevenDay: new Date(SEVEN_DAY_RESET.getTime() - 7 * 24 * 60 * 60 * 1000)
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.userRow = undefined;
  h.defaultQuotaRow = undefined;
  h.usageAggregate = null;
  h.usageQueried = false;
});

describe('getUserQuota', () => {
  it('source=none (no quota set) → free, no usage query made', async () => {
    givenQuota(null);

    const out = await getUserQuota('u1');

    expect(h.usageQueried).toBe(false);
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
    givenQuota({
      name: 'Pro',
      isUnlimited: false,
      fiveHour: '10',
      sevenDay: '100'
    });
    givenUsage(2.5, 40);

    const out = await getUserQuota('u1');

    // 5h: (10-2.5)/10 = 75%; 7d: (100-40)/100 = 60%
    expect(out.fiveHour?.remainingPct).toBe(75);
    expect(out.sevenDay?.remainingPct).toBe(60);
    expect(out.fiveHour?.resetAt).toEqual(FIVE_HOUR_RESET);
    // No raw caps / used amounts in the output.
    expect(JSON.stringify(out)).not.toContain('"used"');
    expect(JSON.stringify(out)).not.toContain('"cap"');
  });

  it('clamps remainingPct at 0 when usage exceeds cap', async () => {
    givenQuota({
      name: 'Pro',
      isUnlimited: false,
      fiveHour: '10',
      sevenDay: null
    });
    givenUsage(25, 0);

    const out = await getUserQuota('u1');
    expect(out.fiveHour?.remainingPct).toBe(0);
    expect(out.sevenDay).toBeUndefined();
  });
});

describe('assertQuota', () => {
  it('returns immediately for unlimited quota (no usage query)', async () => {
    givenQuota({
      isUnlimited: true,
      fiveHour: null,
      sevenDay: null
    });
    await expect(assertQuota('u1')).resolves.toBeUndefined();
    expect(h.usageQueried).toBe(false);
  });

  /**
   * A quota is what lets someone spend. No override, no plan quota and no
   * default is not "unlimited" — that is a quota too, and has to be given.
   */
  it('refuses a user with no quota at all', async () => {
    givenQuota(null);
    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaMissingError);
    expect(h.usageQueried).toBe(false);
  });

  it('passes a quota that sets no caps, without reading usage', async () => {
    givenQuota({
      isUnlimited: false,
      fiveHour: null,
      sevenDay: null
    });
    await expect(assertQuota('u1')).resolves.toBeUndefined();
    expect(h.usageQueried).toBe(false);
  });

  it('throws QuotaExceededError when 5-hour usage reaches the cap', async () => {
    givenQuota({
      isUnlimited: false,
      fiveHour: '10',
      sevenDay: '100'
    });
    givenUsage(10, 0);

    await expect(assertQuota('u1')).rejects.toBeInstanceOf(QuotaExceededError);
    await expect(assertQuota('u1')).rejects.toMatchObject({
      resetAt: FIVE_HOUR_RESET
    });
  });

  it('throws on weekly cap when 5-hour is under but weekly is reached', async () => {
    givenQuota({
      isUnlimited: false,
      fiveHour: '10',
      sevenDay: '100'
    });
    givenUsage(1, 100);

    await expect(assertQuota('u1')).rejects.toMatchObject({
      resetAt: SEVEN_DAY_RESET
    });
  });

  it('does not throw when usage is below both caps', async () => {
    givenQuota({
      isUnlimited: false,
      fiveHour: '10',
      sevenDay: '100'
    });
    givenUsage(9.99, 99);
    await expect(assertQuota('u1')).resolves.toBeUndefined();
  });
});
