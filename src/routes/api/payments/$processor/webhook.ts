import { createFileRoute } from '@tanstack/react-router';

import { paymentProcessorSchema } from '@/types/payment';
import { PublicError } from '@/server/public-error';
import { WebhookSignatureError } from '@/server/services/payment-processor';
import { handleWebhook } from '@/server/services/subscription';

/**
 * A payment processor's webhook, one address per processor. No session: the
 * processor is the caller, and it proves itself by signing the body, which
 * is why the body is read as text — the signature is over the exact bytes.
 *
 * Handled whether or not subscriptions are on: a subscription already bought
 * keeps being kept in step.
 */
export const Route = createFileRoute('/api/payments/$processor/webhook')({
  server: { handlers: { POST } }
});

async function POST({
  request,
  params
}: {
  request: Request;
  params: { processor: string };
}) {
  const processor = paymentProcessorSchema.safeParse(params.processor);
  if (!processor.success) {
    return Response.json(
      { error: 'Unknown payment processor.' },
      { status: 404 }
    );
  }

  try {
    await handleWebhook(processor.data, await request.text(), request.headers);
    return Response.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[payments] ${processor.data} webhook failed:`, message);
    // A bad signature is refused for good. Anything else is a failure the
    // processor should retry, which a 5xx tells it to — including keys that
    // are not set yet, and a payment reported before its subscription.
    if (err instanceof WebhookSignatureError) {
      return Response.json({ error: 'Invalid signature.' }, { status: 400 });
    }
    return Response.json(
      { error: err instanceof PublicError ? message : 'Webhook failed.' },
      { status: err instanceof PublicError ? 503 : 500 }
    );
  }
}
