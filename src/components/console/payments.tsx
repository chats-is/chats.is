import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';

import {
  PAYMENT_PROCESSORS,
  PAYMENT_STATUS_LABELS,
  paymentStatusSchema
} from '@/types/payment';
import { formatPrice } from '@/lib/format-amount';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  openInvoice,
  paymentQueries,
  type listPayments
} from '@/server/functions/payment';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  paymentKindLabelOf,
  processorLabelOf
} from '@/components/billing-labels';
import { PaymentStatusBadge } from '@/components/billing-status';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';
import {
  RefundDialog,
  type RefundTarget
} from '@/components/console/refund-dialog';
import { refundBlockedOf, RowAction } from '@/components/console/row-action';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { paymentTableInput } from '@/components/console/table-filters';
import {
  ConsoleFilters,
  ConsoleSearch,
  ConsoleToolbar
} from '@/components/console/toolbar';
import { UserCell } from '@/components/console/user-cell';
import { InvoiceLink } from '@/components/invoice-link';
import { LocalTime } from '@/components/local-time';
import { RefundedAmount } from '@/components/payment-refund';

type Row = Awaited<ReturnType<typeof listPayments>>['rows'][number];

const helper = createAppColumnHelper<Row>();

/** A dollar amount, or a dash where the processor did not say. */
const moneyOrDash = (value: string | null) =>
  value == null ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    formatPrice(value)
  );

const paymentColumns = (act: (payment: Row) => void) =>
  helper.columns([
    helper.display({
      id: 'user',
      header: 'User',
      meta: { headClassName: 'w-52', cellClassName: 'max-w-0' },
      cell: ({ row }) => (
        <UserCell user={row.original.user} email={row.original.userEmail} />
      )
    }),
    helper.display({
      id: 'plan',
      header: 'Plan',
      cell: ({ row }) => (
        <span className="text-sm">{row.original.plan.name}</span>
      )
    }),
    helper.display({
      id: 'kind',
      header: 'Type',
      cell: ({ row }) => (
        <Badge variant="secondary" className="text-muted-foreground">
          {paymentKindLabelOf(row.original.kind)}
        </Badge>
      )
    }),
    helper.display({
      id: 'amount',
      header: 'Amount',
      meta: { cellClassName: 'text-sm font-medium tabular-nums' },
      cell: ({ row }) => formatPrice(row.original.amount)
    }),
    helper.display({
      id: 'fee',
      header: 'Fee',
      meta: { cellClassName: 'text-sm text-muted-foreground tabular-nums' },
      cell: ({ row }) => moneyOrDash(row.original.fee)
    }),
    helper.display({
      id: 'tax',
      header: 'Tax',
      meta: { cellClassName: 'text-sm text-muted-foreground tabular-nums' },
      cell: ({ row }) => moneyOrDash(row.original.tax)
    }),
    helper.display({
      id: 'refunded',
      header: 'Refunded',
      meta: { cellClassName: 'text-sm' },
      cell: ({ row }) => <RefundedAmount payment={row.original} showSource />
    }),
    helper.display({
      id: 'refundFee',
      header: 'Refund Fee',
      meta: { cellClassName: 'text-sm text-muted-foreground tabular-nums' },
      // The rule a refund sent from here went by, and what it kept back:
      // what was paid less what went back.
      cell: ({ row }) => {
        const { refundFee, amount, refundAmount } = row.original;
        if (refundFee == null) return null;
        const rule = refundFee === 'auto' ? 'Auto' : `${refundFee}%`;
        const kept = Math.max(0, Number(amount) - Number(refundAmount));
        return (
          <span className="whitespace-nowrap">
            {rule} · {formatPrice(kept)}
          </span>
        );
      }
    }),
    helper.display({
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <PaymentStatusBadge status={row.original.status} />
    }),
    helper.display({
      id: 'processor',
      header: 'Processor',
      cell: ({ row }) => (
        <span className="text-sm">
          {processorLabelOf(row.original.processor)}
        </span>
      )
    }),
    helper.display({
      id: 'date',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap">
          <LocalTime value={row.original.billedAt} />
        </span>
      )
    }),
    helper.display({
      id: 'actions',
      header: 'Actions',
      meta: {
        align: 'right',
        headClassName: 'w-24',
        cellClassName: 'whitespace-nowrap'
      },
      cell: ({ row }) => (
        <>
          <InvoiceLink
            url={row.original.invoiceUrl}
            onDemand={row.original.invoiceOnDemand}
            open={() => openInvoice({ data: { id: row.original.id } })}
          />
          <RowAction
            icon={Undo2}
            label="Refund"
            disabled={refundBlockedOf(row.original)}
            onClick={() => act(row.original)}
          />
        </>
      )
    })
  ]);

/** The columns as the skeleton draws them; its rows have no actions. */
const columns = paymentColumns(() => {});

const STATUSES = paymentStatusSchema.options.map(value => ({
  value,
  label: PAYMENT_STATUS_LABELS[value]
}));

export function PaymentsPending() {
  return <ConsoleTableSkeleton columns={columns} filters={2} action="none" />;
}

/**
 * Every payment the processors took or tried to, newest first: what it was
 * for, what the processor kept, and what has been refunded of it.
 */
export default function Payments() {
  const [search, setSearch] = useSearchFilter('q', '');
  const [status, setStatus] = useSearchFilter('status', 'all');
  const [processor, setProcessor] = useSearchFilter('processor', 'all');
  const [page, setPage] = useSearchFilter('page', 1);
  const { data, isLoading, isPlaceholderData } = useQuery(
    paymentQueries.list(
      paymentTableInput({ q: search, status, processor, page })
    )
  );
  const [acting, setActing] = useState<RefundTarget | null>(null);

  return (
    <div className="space-y-6">
      <ConsoleToolbar>
        <ConsoleFilters>
          <ConsoleSearch
            placeholder="Search by name or email..."
            value={search}
            onChange={setSearch}
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map(s => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={processor} onValueChange={setProcessor}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Processors</SelectItem>
              {PAYMENT_PROCESSORS.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConsoleFilters>
      </ConsoleToolbar>
      <RefundDialog target={acting} onClose={() => setActing(null)} />
      <DataTable
        columns={paymentColumns(p => setActing({ payment: p.id }))}
        data={isLoading ? undefined : data?.rows}
        empty="No payments match."
        pending={isPlaceholderData}
        pagination={
          data && {
            page: data.page,
            pageSize: data.pageSize,
            total: data.total,
            onPageChange: setPage
          }
        }
      />
    </div>
  );
}
