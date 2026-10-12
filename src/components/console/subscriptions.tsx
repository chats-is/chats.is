import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarX, Info } from 'lucide-react';
import { toast } from 'sonner';

import { PAYMENT_PROCESSORS, SUBSCRIPTION_STATUS_LABELS } from '@/lib/constant';
import { formatPrice } from '@/lib/format-amount';
import { mutating } from '@/lib/mutation';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  adminCancelSubscription,
  subscriptionQueries,
  type listSubscriptions
} from '@/server/functions/subscription';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { processorLabelOf } from '@/components/billing-labels';
import {
  SubscriptionNote,
  SubscriptionStatusTag
} from '@/components/billing-status';
import { CancelSubscriptionDialog } from '@/components/cancel-subscription-dialog';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';
import { RowAction } from '@/components/console/row-action';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { SubscriptionDetailSheet } from '@/components/console/subscription-detail';
import { subscriptionTableInput } from '@/components/console/table-filters';
import {
  ConsoleFilters,
  ConsoleSearch,
  ConsoleToolbar
} from '@/components/console/toolbar';
import { UserCell } from '@/components/console/user-cell';
import { LocalTime } from '@/components/local-time';

type Row = Awaited<ReturnType<typeof listSubscriptions>>['rows'][number];

const helper = createAppColumnHelper<Row>();

const STATUSES = (['active', 'canceled', 'ended'] as const).map(value => ({
  value,
  label: SUBSCRIPTION_STATUS_LABELS[value]
}));

const subscriptionColumns = (
  open: (row: Row) => void,
  cancel: (row: Row) => void
) =>
  helper.columns([
    helper.display({
      id: 'user',
      header: 'User',
      meta: { headClassName: 'w-52 min-w-52', cellClassName: 'max-w-0' },
      cell: ({ row }) => <UserCell user={row.original.user} />
    }),
    helper.display({
      id: 'plan',
      header: 'Plan',
      meta: { headClassName: 'w-32 min-w-32' },
      cell: ({ row }) => (
        <span className="text-sm">{row.original.planName}</span>
      )
    }),
    helper.display({
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <SubscriptionStatusTag sub={row.original} />
    }),
    helper.display({
      id: 'expires',
      header: 'Expires',
      // The day it renews or ends — or, ended, when it did.
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap">
          <SubscriptionNote sub={row.original} />
        </span>
      )
    }),
    helper.display({
      id: 'paid',
      header: 'Paid',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">
          {formatPrice(row.original.paid)}
        </span>
      )
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
      id: 'created',
      header: 'Created',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap">
          <LocalTime value={row.original.createdAt} />
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
          {/* Only one that renews: canceled, it ends at its period end. */}
          <RowAction
            icon={CalendarX}
            label="Cancel subscription"
            disabled={
              row.original.status === 'ended'
                ? 'Already ended'
                : row.original.status === 'canceled'
                  ? 'Already canceled'
                  : null
            }
            onClick={() => cancel(row.original)}
          />
          <RowAction
            icon={Info}
            label="Details"
            onClick={() => open(row.original)}
          />
        </>
      )
    })
  ]);

/** The columns as the skeleton draws them; its rows open nothing. */
const columns = subscriptionColumns(
  () => {},
  () => {}
);

export function SubscriptionsPending() {
  return <ConsoleTableSkeleton columns={columns} filters={2} action="none" />;
}

/**
 * Every subscription, newest first — by status, processor or user — with
 * where each stands and what it has paid. Details opens one whole: its
 * payments and refund requests, and what can be done to it.
 */
export default function Subscriptions() {
  const [search, setSearch] = useSearchFilter('q', '');
  const [status, setStatus] = useSearchFilter('status', 'all');
  const [processor, setProcessor] = useSearchFilter('processor', 'all');
  const [page, setPage] = useSearchFilter('page', 1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [canceling, setCanceling] = useState<Row | null>(null);
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: mutating(adminCancelSubscription),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: subscriptionQueries.all()
      });
    },
    onError: (e: Error) => toast.error(e.message)
  });

  const { data, isLoading, isPlaceholderData } = useQuery(
    subscriptionQueries.list(
      subscriptionTableInput({ q: search, status, processor, page })
    )
  );

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
            <SelectTrigger className="w-36">
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

      <DataTable
        columns={subscriptionColumns(
          row => setOpenId(row.id),
          row => setCanceling(row)
        )}
        data={isLoading ? undefined : data?.rows}
        empty="No subscriptions match."
        pending={isPlaceholderData}
        getRowId={row => row.id}
        pagination={
          data && {
            page: data.page,
            pageSize: data.pageSize,
            total: data.total,
            onPageChange: setPage
          }
        }
      />

      <SubscriptionDetailSheet id={openId} onClose={() => setOpenId(null)} />

      {canceling && (
        <CancelSubscriptionDialog
          open
          onOpenChange={open => !open && setCanceling(null)}
          planName={canceling.planName}
          periodEnd={canceling.periodEnd}
          byAdmin
          // A renewal unpaid: nothing paid for is left, so it ends.
          ends={canceling.paymentFailed}
          onConfirm={() =>
            cancel.mutate(
              { id: canceling.id },
              {
                onSuccess: () =>
                  toast.success(
                    canceling.paymentFailed ? 'Ended.' : 'Canceled.'
                  )
              }
            )
          }
        />
      )}
    </div>
  );
}
