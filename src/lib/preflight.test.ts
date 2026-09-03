import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PricingMissingError, requirePricing } from '@/lib/pricing';
import {
  assertModelAccess,
  assertQuota,
  ModelAccessDeniedError,
  QuotaExceededError
} from '@/lib/quota';

import { preflightCheck } from './preflight';

// preflight.ts composes the pricing/quota gates; mock those layers entirely
// (importing the real ones pulls in the DB/env chain). The error classes are
// replicated inside the factories so `instanceof` in preflight.ts matches the
// instances the tests construct.
vi.mock('@/lib/pricing', () => {
  class PricingMissingError extends Error {
    public userMessage: string;
    constructor(modelLabel: string) {
      super(`Model ${modelLabel} is not configured for billing.`);
      this.name = 'PricingMissingError';
      this.userMessage = `${modelLabel} has no pricing yet. Set it under Console → Pricing (0 is fine) to enable the model.`;
    }
  }
  return { PricingMissingError, requirePricing: vi.fn() };
});
vi.mock('@/lib/quota', () => {
  class ModelAccessDeniedError extends Error {
    constructor(modelLabel: string) {
      super(`${modelLabel} is not available.`);
      this.name = 'ModelAccessDeniedError';
    }
  }
  class QuotaExceededError extends Error {
    public resetAt: Date | null;
    constructor(detail: { resetAt: Date | null }) {
      super('You’ve reached your usage limit. Please try again later.');
      this.name = 'QuotaExceededError';
      this.resetAt = detail.resetAt;
    }
  }
  return {
    ModelAccessDeniedError,
    QuotaExceededError,
    assertModelAccess: vi.fn(),
    assertQuota: vi.fn()
  };
});

const mockRequirePricing = vi.mocked(requirePricing);
const mockAssertModelAccess = vi.mocked(assertModelAccess);
const mockAssertQuota = vi.mocked(assertQuota);

const args = {
  userId: 'user-1',
  modelKey: 'gpt-4o',
  modelLabel: 'GPT-4o',
  capability: 'chat' as const
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePricing.mockResolvedValue(undefined as never);
  mockAssertModelAccess.mockResolvedValue(undefined);
  mockAssertQuota.mockResolvedValue(undefined);
});

describe('preflightCheck', () => {
  it('returns ok when every gate passes', async () => {
    await expect(preflightCheck(args)).resolves.toEqual({ ok: true });
  });

  it('maps PricingMissingError to a 403 with the user-facing message', async () => {
    mockRequirePricing.mockRejectedValue(new PricingMissingError('GPT-4o'));
    const result = await preflightCheck(args);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.message).toMatch(/no pricing yet/i);
    }
  });

  it('maps ModelAccessDeniedError to a 403', async () => {
    mockAssertModelAccess.mockRejectedValue(
      new ModelAccessDeniedError('GPT-4o')
    );
    const result = await preflightCheck(args);
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('maps QuotaExceededError to a 429', async () => {
    mockAssertQuota.mockRejectedValue(
      new QuotaExceededError({ resetAt: new Date('2026-01-01T05:00:00Z') })
    );
    const result = await preflightCheck(args);
    expect(result).toMatchObject({ ok: false, status: 429 });
  });

  it('rethrows unexpected errors', async () => {
    mockRequirePricing.mockRejectedValue(new Error('db down'));
    await expect(preflightCheck(args)).rejects.toThrow('db down');
  });
});
