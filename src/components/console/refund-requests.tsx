import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  REFUND_REQUEST_STATUS_LABELS,
  type RefundRequestStatus
} from '@/types/payment';
import { formatPrice } from '@/lib/format-amount';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  subscriptionQueries,
  type listRefundRequests
} from '@/server/functions/subscription';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  RefundRequestStatusBadge,
  SubscriptionStatusWithDate
} from '@/components/billing-status';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';
import { RefundDialog, ReviewAction } from '@/components/console/refund-dialog';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { refundRequestTableInput } from '@/components/console/table-filters';
import {
  ConsoleFilters,
  ConsoleSearch,
  ConsoleToolbar
} from '@/components/console/toolbar';
import { UserCell } from '@/components/console/user-cell';
import { LocalTime } from '@/components/local-time';

type Row = Awaited<ReturnType<typeof listRefundRequests>>['rows'][number];

const helper = createAppColumnHelper<Row>();

const STATUSES = (
  ['pending_approval', 'approved', 'rejected'] as RefundRequestStatus[]
).map(value => ({ value, label: REFUND_REQUEST_STATUS_LABELS[value] }));

const requestColumns = (review: (row: Row) => void) =>
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
        <span className="text-sm">
          {row.original.subscription.plan?.name ?? '—'}
        </span>
      )
    }),
    // The subscription asked about.
    helper.display({
      id: 'subscription',
      header: 'Subscription',
      meta: { headClassName: 'w-28' },
      cell: ({ row }) => (
        <SubscriptionStatusWithDate sub={row.original.subscription} />
      )
    }),
    helper.display({
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <RefundRequestStatusBadge status={row.original.status} />
      )
    }),
    helper.display({
      id: 'refunded',
      header: 'Refunded',
      // What has gone back, in red as money going out is; and whether the
      // processor has still to confirm it.
      cell: ({ row }) => {
        const { refunded, refundPending } = row.original;
        if (refunded <= 0) {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        return (
          <div className="text-sm whitespace-nowrap">
            <div className="text-red-600 tabular-nums dark:text-red-400">
              {formatPrice(refunded)}
            </div>
            {refundPending && (
              <div className="text-xs text-muted-foreground">
                Refund pending
              </div>
            )}
          </div>
        );
      }
    }),
    helper.display({
      id: 'reason',
      header: 'Reason',
      meta: { cellClassName: 'max-w-64' },
      // Why the user asked; under it, rejected, why the admin said no — as
      // the subscription's own page shows them.
      cell: ({ row }) => {
        const { reason, status, rejectionReason } = row.original;
        return (
          <div>
            {reason && (
              <span
                className="line-clamp-2 text-sm text-muted-foreground"
                title={reason}
              >
                {reason}
              </span>
            )}
            {status === 'rejected' && rejectionReason && (
              <div
                className="truncate text-xs text-muted-foreground"
                title={rejectionReason}
              >
                Rejected: {rejectionReason}
              </div>
            )}
          </div>
        );
      }
    }),
    helper.display({
      id: 'submitted',
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
      meta: { align: 'right', headClassName: 'w-24' },
      cell: ({ row }) => (
        <ReviewAction
          status={row.original.status}
          onClick={() => review(row.original)}
        />
      )
    })
  ]);

const columns = requestColumns(() => {});

export function RefundRequestsPending() {
  return <ConsoleTableSkeleton columns={columns} filters={1} action="text" />;
}

/**
 * Users' refund requests, newest first: the ones pending approval to
 * decide on — approve with the amounts to refund, or reject — and the ones
 * decided, to look back on.
 */
export default function RefundRequests() {
  const [search, setSearch] = useSearchFilter('q', '');
  const [status, setStatus] = useSearchFilter('status', 'all');
  const [page, setPage] = useSearchFilter('page', 1);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, isPlaceholderData } = useQuery(
    subscriptionQueries.refundRequests(
      refundRequestTableInput({ q: search, status, page })
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
            <SelectTrigger className="w-44">
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
        </ConsoleFilters>
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.pendingApproval} pending approval
          </span>
        )}
      </ConsoleToolbar>

      <DataTable
        columns={requestColumns(row => setOpenId(row.id))}
        data={isLoading ? undefined : data?.rows}
        empty="No refund requests match."
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

      <RefundDialog
        target={openId ? { request: openId } : null}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
