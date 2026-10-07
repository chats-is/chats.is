import { Fragment, useState } from 'react';
import { Info } from 'lucide-react';

import { PAYMENT_PROCESSORS, type PaymentProcessorId } from '@/types/payment';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

/** What a processor needs configured: the `.env` variables, the events
 *  its webhook sends, and what its API key may do — as the adapters use
 *  it. */
type Requirements = {
  /** Each variable, with what it holds. */
  env: [name: string, holds: string][];
  events: string[];
  permissions: string[];
};

const REQUIREMENTS: Record<PaymentProcessorId, Requirements> = {
  stripe: {
    env: [
      ['STRIPE_SECRET_KEY', 'The secret API key'],
      ['STRIPE_WEBHOOK_SECRET', 'The webhook signing secret']
    ],
    events: [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'customer.subscription.paused',
      'customer.subscription.resumed',
      'invoice.paid',
      'invoice.payment_failed',
      'refund.created',
      'refund.updated',
      'charge.dispute.created',
      'charge.dispute.funds_withdrawn',
      'charge.dispute.funds_reinstated',
      'charge.dispute.closed'
    ],
    permissions: [
      'Checkout Sessions: Write',
      'Subscriptions: Write',
      'Prices: Read',
      'Invoices: Read',
      'Payment Intents: Read',
      'Charges and Refunds: Write',
      'Customers: Read',
      'Payment Methods: Read',
      'Customer Portal: Write',
      'Balance Transaction Sources: Read'
    ]
  },
  paddle: {
    env: [
      ['PADDLE_API_KEY', 'The API key'],
      ['PADDLE_WEBHOOK_SECRET', 'The webhook secret key'],
      ['PADDLE_CLIENT_TOKEN', 'The client-side token']
    ],
    events: [
      'subscription.created',
      'subscription.updated',
      'subscription.activated',
      'subscription.canceled',
      'subscription.past_due',
      'subscription.paused',
      'subscription.resumed',
      'transaction.completed',
      'transaction.payment_failed',
      'adjustment.created',
      'adjustment.updated'
    ],
    permissions: [
      'Customers: Write',
      'Prices: Read',
      'Subscriptions: Write',
      'Transactions: Write',
      'Adjustments: Write',
      'Customer portal sessions: Write'
    ]
  },
  lemonsqueezy: {
    env: [
      ['LEMONSQUEEZY_API_KEY', 'The API key'],
      ['LEMONSQUEEZY_WEBHOOK_SECRET', 'The webhook signing secret'],
      ['LEMONSQUEEZY_STORE_ID', 'The store ID']
    ],
    events: [
      'subscription_created',
      'subscription_updated',
      'subscription_cancelled',
      'subscription_resumed',
      'subscription_expired',
      'subscription_paused',
      'subscription_unpaused',
      'subscription_payment_success',
      'subscription_payment_failed',
      'subscription_payment_recovered',
      'subscription_payment_refunded'
    ],
    // Its API keys carry no permissions to set.
    permissions: []
  }
};

/**
 * An icon after a label, opening the payment configuration in a dialog.
 */
export function PaymentHelpButton({
  processor
}: {
  /** The processor shown first. */
  processor?: PaymentProcessorId;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Payment Configuration"
            className="inline-flex text-muted-foreground hover:text-foreground"
          >
            <Info className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Payment Configuration</TooltipContent>
      </Tooltip>
      <PaymentHelpDialog
        open={open}
        onOpenChange={setOpen}
        initial={processor ?? 'stripe'}
      />
    </>
  );
}

/**
 * The same, as a line across a form: a prompt to configure payment, with
 * an icon that opens the configuration.
 */
export function PaymentHelpAlert({
  processor
}: {
  processor?: PaymentProcessorId;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
        <Info className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">
          Please configure payment information first.
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setOpen(true)}
          className="-my-0.5 shrink-0"
        >
          Open
        </Button>
      </div>
      <PaymentHelpDialog
        open={open}
        onOpenChange={setOpen}
        initial={processor ?? 'stripe'}
      />
    </>
  );
}

function PaymentHelpDialog({
  open,
  onOpenChange,
  initial
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: PaymentProcessorId;
}) {
  const [shown, setShown] = useState<PaymentProcessorId>(initial);
  const req = REQUIREMENTS[shown];
  const webhook =
    typeof window === 'undefined'
      ? `/api/payments/${shown}/webhook`
      : `${window.location.origin}/api/payments/${shown}/webhook`;
  const host = typeof window === 'undefined' ? '' : window.location.host;

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (next) setShown(initial);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Payment Configuration</DialogTitle>
          <DialogDescription>
            What each payment platform needs configured.
          </DialogDescription>
        </DialogHeader>

        <div className="inline-flex w-fit rounded-md border p-0.5">
          {PAYMENT_PROCESSORS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => setShown(p.id)}
              className={cn(
                'rounded px-3 py-1 text-sm',
                shown === p.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="space-y-4 text-sm">
          <Section title="Environment Variables">
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
              {req.env.map(([name, holds]) => (
                <Fragment key={name}>
                  <dt>
                    <Codes items={[name]} />
                  </dt>
                  <dd className="text-muted-foreground">{holds}</dd>
                </Fragment>
              ))}
            </dl>
          </Section>
          <Section title="Webhook URL">
            <Codes items={[webhook]} />
          </Section>
          <Section title="Webhook Events" note="Needs these webhook events.">
            <Codes items={req.events} />
          </Section>
          {req.permissions.length > 0 && (
            <Section
              title="API Key Permissions"
              note="Needs these API key permissions."
            >
              <Codes items={req.permissions} />
            </Section>
          )}
          {shown === 'paddle' && (
            <Section
              title="Approved Domain"
              note="This domain needs to be approved in Paddle."
            >
              <Codes items={[host]} />
            </Section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  note,
  children
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div>
        <h3 className="font-medium">{title}</h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Codes({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(i => (
        <code
          key={i}
          className="rounded bg-muted px-1.5 py-0.5 text-xs break-all"
        >
          {i}
        </code>
      ))}
    </div>
  );
}
