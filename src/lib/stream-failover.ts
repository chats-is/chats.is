import { type streamText } from 'ai';

/**
 * Whether a stream opened with an error, and which.
 *
 * A provider that cannot serve a turn says so before it says anything else: a
 * bad key, a rate limit and an outage all arrive as the stream's first part,
 * not as a throw — building the stream never touches the network. This reads
 * up to the first part of substance and answers with the error if that is what
 * it was. Once a token has been seen the provider is settled; swapping after
 * that would repeat output.
 *
 * Every read of `fullStream` is a branch of its own, so what is read here is
 * still there for whoever streams the result to the client afterwards.
 */
export async function openedWithError(
  attempt: Pick<ReturnType<typeof streamText>, 'fullStream'>
): Promise<{ error: unknown } | undefined> {
  const reader = attempt.fullStream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return undefined;
      if (value.type === 'error') return { error: value.error };
      if (value.type !== 'start' && value.type !== 'start-step') {
        return undefined;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
