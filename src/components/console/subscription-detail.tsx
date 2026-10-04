import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Undo2 } from 'lucide-react';

import { formatPrice } from '@/lib/format-amount';
import { openInvoice } from '@/server/functions/payment';
import {
  subscriptionQueries,
  type getSubscriptionDetail
} from '@/server/functions/subscription';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { processorLabelOf } from '@/components/billing-labels';
import {
  PaymentStatusBadge,
  RefundRequestStatusBadge,
  SubscriptionNote,
  SubscriptionStatusTag
} from '@/components/billing-status';
import {
  RefundDialog,
  ReviewAction,
  type RefundTarget
} from '@/components/console/refund-dialog';
import { refundBlockedOf, RowAction } from '@/components/console/row-action';
import { UserCell } from '@/components/console/user-cell';
import { InvoiceLink } from '@/components/invoice-link';
import { LocalTime } from '@/components/local-time';
import { RefundedAmount } from '@/components/payment-refund';

type Detail = Awaited<ReturnType<typeof getSubscriptionDetail>>;

/**
 * One subscription, whole, beside the list: where it stands and what it
 * charges next, what can be done to it, its history, and its payments with
 * their refunds.
 */
export function SubscriptionDetailSheet({
  id,
  onClose
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    ...subscriptionQueries.detail(id ?? ''),
    enabled: !!id
  });
  return (
    <Sheet open={!!id} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>Subscription</SheetTitle>
          <SheetDescription className="sr-only">
            One subscription, whole.
          </SheetDescription>
        </SheetHeader>
        {isLoading || !data ? (
          <div className="space-y-4 p-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-60 w-full" />
          </div>
        ) : (
          <DetailBody detail={data} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-b p-4 last:border-b-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function DetailBody({ detail: d }: { detail: Detail }) {
  const [acting, setActing] = useState<RefundTarget | null>(null);

  return (
    <div>
      <RefundDialog target={acting} onClose={() => setActing(null)} />

      <Section title="Overview">
        <dl className="space-y-2">
          <Field label="User">
            <UserCell user={d.user} />
          </Field>
          <Field label="Plan">
            <span className="font-medium">{d.planName}</span>
            <span className="text-muted-foreground">
              {' '}
              {formatPrice(d.price)} / {d.interval}
            </span>
          </Field>
          <Field label="Status">
            <SubscriptionStatusTag sub={d} />
          </Field>
          <Field label="Expires">
            <SubscriptionNote sub={d} />
          </Field>
          <Field label="Created">
            <LocalTime value={d.createdAt} />
          </Field>
          <Field label="Processor">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-x-3">
                {processorLabelOf(d.processor)}
                {d.dashboardUrl && (
                  <a
                    href={d.dashboardUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-primary hover:underline"
                  >
                    Open in {processorLabelOf(d.processor)}
                    <ExternalLink className="size-3 text-muted-foreground" />
                  </a>
                )}
              </div>
              <div className="font-mono text-xs break-all text-muted-foreground">
                Subscription {d.externalId}
              </div>
              <div className="font-mono text-xs break-all text-muted-foreground">
                Customer {d.customerId}
              </div>
            </div>
          </Field>
        </dl>
      </Section>

      <Section title="Payments">
        {d.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Date</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-4 text-muted-foreground">
                      {/* One width, so the dates of every table line up. */}
                      <div className="w-40">
                        <LocalTime value={p.billedAt} />
                      </div>
                    </TableCell>
                    <TableCell className="w-full">{p.plan.name}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatPrice(p.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <RefundedAmount payment={p} showSource />
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="pr-4 text-right whitespace-nowrap">
                      <InvoiceLink
                        url={p.invoiceUrl}
                        onDemand={p.invoiceOnDemand}
                        open={() => openInvoice({ data: { id: p.id } })}
                      />
                      <RowAction
                        icon={Undo2}
                        label="Refund"
                        disabled={refundBlockedOf(p)}
                        onClick={() => setActing({ payment: p.id })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Refund requests">
        {d.refundRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          // A table, as its payments are.
          <div className="rounded-md border">
            <Table>
              <TableBody>
                {d.refundRequests.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4 text-muted-foreground">
                      {/* One width, so the dates of every table line up. */}
                      <div className="w-40">
                        <LocalTime value={r.createdAt} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <RefundRequestStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="w-full max-w-0 whitespace-normal">
                      <div className="truncate" title={r.reason ?? undefined}>
                        {r.reason}
                      </div>
                      {r.status === 'rejected' && r.rejectionReason && (
                        <div
                          className="truncate text-xs text-muted-foreground"
                          title={r.rejectionReason}
                        >
                          Rejected: {r.rejectionReason}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <ReviewAction
                        status={r.status}
                        onClick={() => setActing({ request: r.id })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}
