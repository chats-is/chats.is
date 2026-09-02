import { describe, expect, it } from 'vitest'

import { chatRequestErrorMessage } from './message-error'

describe('chatRequestErrorMessage', () => {
  it('unwraps the reason our route sends', () => {
    // The AI SDK transport rejects with the raw response body, so a refusal
    // from /api/chat arrives as the serialized NextResponse.json payload.
    const error = new Error(
      '{"error":"GPT-4o has no pricing yet. Set it under Console → Pricing (0 is fine) to enable the model."}',
    )

    expect(chatRequestErrorMessage(error)).toBe(
      'GPT-4o has no pricing yet. Set it under Console → Pricing (0 is fine) to enable the model.',
    )
  })

  it('passes through a body that is not our JSON shape', () => {
    // A proxy or platform error page never reaches our route, so it has no
    // `error` key — showing it raw beats showing nothing.
    expect(chatRequestErrorMessage(new Error('502 Bad Gateway'))).toBe(
      '502 Bad Gateway',
    )
  })

  it('passes through JSON that has no error string', () => {
    expect(chatRequestErrorMessage(new Error('{"detail":"nope"}'))).toBe(
      '{"detail":"nope"}',
    )
    expect(chatRequestErrorMessage(new Error('{"error":123}'))).toBe(
      '{"error":123}',
    )
  })

  it('falls back when there is no message to show', () => {
    expect(chatRequestErrorMessage(undefined)).toBe('Something went wrong.')
    expect(chatRequestErrorMessage(new Error('   '))).toBe(
      'Something went wrong.',
    )
  })
})
