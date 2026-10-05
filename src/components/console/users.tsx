import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleCheck,
  ExternalLink,
  Loader2,
  Mail,
  ShieldCheck,
  Trash2,
  User as UserIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { mutating } from '@/lib/mutation';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  quotaQueries,
  removeUserQuota,
  setUserQuota
} from '@/server/functions/quota';
import { setUserTier, tierQueries } from '@/server/functions/tier';
import {
  deleteUser,
  updateUserRole,
  userQueries,
  type listUsers
} from '@/server/functions/user';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';
import { RowAction } from '@/components/console/row-action';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { userTableInput } from '@/components/console/table-filters';
import { TierLabel } from '@/components/console/tier-label';
import {
  ConsoleFilters,
  ConsoleSearch,
  ConsoleToolbar
} from '@/components/console/toolbar';
import { IconGitHub, IconGoogle } from '@/components/icons';
import { LocalTime } from '@/components/local-time';

type User = Awaited<ReturnType<typeof listUsers>>['rows'][number];
type QuotaOption = { id: string; name: string; isUnlimited: boolean };
type TierOption = {
  id: string;
  name: string;
  priceMultiplier: string | null;
};

const ProviderIcon = ({ provider }: { provider: string }) => {
  switch (provider.toLowerCase()) {
    case 'github':
      return <IconGitHub className="size-4" />;
    case 'google':
      return <IconGoogle className="size-4" />;
    case 'email-code':
    case 'email':
      return <Mail className="size-4" />;
    default:
      return <span className="text-xs">{provider}</span>;
  }
};

const QUOTA_NONE = '__none__';
const TIER_NONE = '__none__';

const helper = createAppColumnHelper<User>();

/**
 * The role and quota cells write straight to the server, so the column list
 * needs the mutations and the per-row "which one is saving" flags.
 */
const userColumns = (ctx: {
  quotaOptions: Array<QuotaOption> | undefined;
  tierOptions: Array<TierOption> | undefined;
  updatingRoleUserId: string | null;
  updatingQuotaUserId: string | null;
  updatingTierUserId: string | null;
  setRole: (user: User, role: 'user' | 'admin') => void;
  setQuota: (user: User, quotaId: string) => void;
  setTier: (user: User, tierId: string) => void;
  remove: (user: User) => void;
}) =>
  helper.columns([
    helper.display({
      id: 'avatar',
      header: '',
      meta: { align: 'center', headClassName: 'w-16 min-w-16' },
      cell: ({ row }) => {
        const user = row.original;
        return (
          <Link
            to="/console/users/$userId"
            params={{ userId: user.id }}
            aria-label={user.name || user.email}
            className="mx-auto block size-8 overflow-hidden rounded-full border bg-muted"
          >
            {user.image ? (
              <img
                src={user.image}
                alt=""
                width={32}
                height={32}
                className="size-full object-cover"
              />
            ) : (
              <span className="flex size-full items-center justify-center text-xs font-medium text-muted-foreground">
                {user.name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
              </span>
            )}
          </Link>
        );
      }
    }),
    // The name, a link to the user, over the address — each cut short
    // rather than wrapped.
    helper.accessor('name', {
      header: 'User',
      meta: { headClassName: 'w-56', cellClassName: 'max-w-0' },
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="min-w-0">
            {/* Styled as the usage log's user link: the name underlines on
                hover, with the icon that says it opens the user. */}
            <Link
              to="/console/users/$userId"
              params={{ userId: user.id }}
              title={user.name || undefined}
              className="group inline-flex max-w-full items-center gap-1 font-medium hover:text-primary"
            >
              <span className="truncate underline-offset-4 group-hover:underline">
                {user.name || 'No name'}
              </span>
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
            </Link>
            <div
              className="truncate text-xs text-muted-foreground"
              title={user.email}
            >
              {user.email}
            </div>
          </div>
        );
      }
    }),
    helper.display({
      id: 'provider',
      header: 'Provider',
      meta: { align: 'center', headClassName: 'w-20' },
      cell: ({ row }) => (
        <div className="flex items-center justify-center gap-2">
          {row.original.accounts && row.original.accounts.length > 0 ? (
            row.original.accounts.map((account, idx) => (
              <ProviderIcon key={idx} provider={account.providerId} />
            ))
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </div>
      )
    }),
    helper.accessor('emailVerified', {
      header: 'Verified',
      meta: {
        align: 'center',
        headClassName: 'w-20',
        cellClassName: 'text-sm'
      },
      // Verification is a yes or no now, not a date: the auth library records
      // whether an address was confirmed, not when. The column always asked
      // "Verified".
      cell: ({ row }) =>
        row.original.emailVerified ? (
          <CircleCheck
            className="mx-auto size-4 text-green-600 dark:text-green-500"
            aria-label="Verified"
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        )
    }),
    helper.accessor('createdAt', {
      header: 'Joined',
      meta: {
        headClassName: 'w-40',
        cellClassName: 'text-sm whitespace-nowrap'
      },
      cell: ({ row }) => <LocalTime value={row.original.createdAt} />
    }),
    helper.accessor(row => row.plan?.name, {
      id: 'plan',
      header: 'Plan',
      meta: {
        align: 'center',
        headClassName: 'w-24',
        cellClassName: 'text-sm'
      },
      cell: ({ row }) => (
        <span className={row.original.plan ? '' : 'text-muted-foreground'}>
          {row.original.plan?.name ?? 'No plan'}
        </span>
      )
    }),
    helper.accessor('role', {
      header: 'Role',
      meta: { align: 'center', headClassName: 'w-32' },
      cell: ({ row }) => {
        const user = row.original;
        const saving = ctx.updatingRoleUserId === user.id;
        return (
          <div className="flex justify-center">
            <Select
              value={user.role}
              disabled={saving}
              onValueChange={value =>
                ctx.setRole(user, value as 'user' | 'admin')
              }
            >
              <SelectTrigger className="w-28">
                {/* Inside a SelectValue, not in place of one: the menu is
                    positioned against the value node, and without one it is
                    never placed — and an unplaced menu takes no choice. */}
                <SelectValue>
                  <div className="flex items-center gap-2">
                    {saving ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : user.role === 'admin' ? (
                      <ShieldCheck className="size-3" />
                    ) : (
                      <UserIcon className="size-3" />
                    )}
                    <span>{user.role === 'admin' ? 'Admin' : 'User'}</span>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">
                  <div className="flex items-center gap-2">
                    <UserIcon className="size-3" />
                    User
                  </div>
                </SelectItem>
                <SelectItem value="admin">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-3" />
                    Admin
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        );
      }
    }),
    helper.accessor(row => row.quota?.id, {
      id: 'quota',
      header: 'Quota',
      meta: { align: 'center', headClassName: 'w-32' },
      cell: ({ row }) => {
        const user = row.original;
        const saving = ctx.updatingQuotaUserId === user.id;
        return (
          <div className="flex justify-center">
            <Select
              value={user.quota?.id ?? QUOTA_NONE}
              disabled={saving || !ctx.quotaOptions?.length}
              onValueChange={value => ctx.setQuota(user, value)}
            >
              <SelectTrigger className="w-28">
                {saving ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <SelectValue placeholder="None" />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={QUOTA_NONE}>
                  <span className="text-muted-foreground">None</span>
                </SelectItem>
                {ctx.quotaOptions?.map(q => (
                  <SelectItem key={q.id} value={q.id}>
                    {q.name}
                    {q.isUnlimited ? ' (∞)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      }
    }),
    // The user's own tier, over the plan's. None follows the plan.
    helper.accessor(row => row.tier?.id, {
      id: 'tier',
      header: 'Tier',
      meta: { align: 'center', headClassName: 'w-32' },
      cell: ({ row }) => {
        const user = row.original;
        const saving = ctx.updatingTierUserId === user.id;
        return (
          <div className="flex justify-center">
            <Select
              value={user.tier?.id ?? TIER_NONE}
              disabled={saving || !ctx.tierOptions?.length}
              onValueChange={value => ctx.setTier(user, value)}
            >
              <SelectTrigger className="w-28">
                {saving ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <SelectValue placeholder="None" />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TIER_NONE}>
                  <span className="text-muted-foreground">None</span>
                </SelectItem>
                {ctx.tierOptions?.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    <TierLabel
                      name={t.name}
                      priceMultiplier={t.priceMultiplier}
                    />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      }
    }),
    helper.display({
      id: 'actions',
      header: 'Actions',
      meta: { align: 'right', headClassName: 'w-24' },
      cell: ({ row }) => (
        <RowAction
          icon={Trash2}
          label="Delete user"
          disabled={
            row.original.role === 'admin'
              ? 'Admins cannot be deleted'
              : row.original.hasLiveSubscription
                ? 'Has a subscription in effect, so it cannot be deleted.'
                : null
          }
          onClick={() => ctx.remove(row.original)}
        />
      )
    })
  ]);

/** Stands in for the row actions, which a placeholder row can never call. */
const noop = () => {};

/**
 * The page while its first rows are on their way.
 *
 * Built from the same column defs the table uses, so the header is the real one
 * and only the rows stand in. Exported as a component rather than as the column
 * list itself: a module that exports anything but components loses Fast Refresh
 * for everything in it.
 *
 * The actions are empty because they cannot fire — a placeholder row has no
 * record to act on, and the cells that would call them are bars.
 */
export function UsersPending() {
  return (
    <ConsoleTableSkeleton
      columns={userColumns({
        quotaOptions: undefined,
        tierOptions: undefined,
        updatingRoleUserId: null,
        updatingQuotaUserId: null,
        updatingTierUserId: null,
        setRole: noop,
        setQuota: noop,
        setTier: noop,
        remove: noop
      })}
      action="text"
    />
  );
}

export default function UsersPage() {
  const [search, setSearch] = useSearchFilter('q', '');
  const [page, setPage] = useSearchFilter('page', 1);
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(
    null
  );
  const [updatingQuotaUserId, setUpdatingQuotaUserId] = useState<string | null>(
    null
  );
  const [updatingTierUserId, setUpdatingTierUserId] = useState<string | null>(
    null
  );
  const [deleting, setDeleting] = useState<User | null>(null);

  const queryClient = useQueryClient();
  const { data, isLoading, isPlaceholderData } = useQuery(
    userQueries.list(userTableInput({ q: search, page }))
  );
  const { data: stats } = useQuery(userQueries.stats());
  const { data: quotaOptions } = useQuery(quotaQueries.listForSelect());
  const { data: tierOptions } = useQuery(tierQueries.listForSelect());

  const updateRoleMutation = useMutation({
    mutationFn: mutating(updateUserRole),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userQueries.key.list() });
      await queryClient.invalidateQueries({
        queryKey: userQueries.key.stats()
      });
      setUpdatingRoleUserId(null);
    },
    onError: error => {
      setUpdatingRoleUserId(null);
      toast.error(error.message);
    }
  });

  const setQuotaMutation = useMutation({
    mutationFn: mutating(setUserQuota),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userQueries.key.list() });
      await queryClient.invalidateQueries({
        queryKey: quotaQueries.key.byUser()
      });
      setUpdatingQuotaUserId(null);
      toast.success('Quota override updated');
    },
    onError: error => {
      setUpdatingQuotaUserId(null);
      toast.error(error.message);
    }
  });

  const removeQuotaMutation = useMutation({
    mutationFn: mutating(removeUserQuota),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userQueries.key.list() });
      await queryClient.invalidateQueries({
        queryKey: quotaQueries.key.byUser()
      });
      setUpdatingQuotaUserId(null);
      toast.success('Quota override removed');
    },
    onError: error => {
      setUpdatingQuotaUserId(null);
      toast.error(error.message);
    }
  });

  const setTierMutation = useMutation({
    mutationFn: mutating(setUserTier),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userQueries.key.list() });
      await queryClient.invalidateQueries({
        queryKey: userQueries.key.detail()
      });
      setUpdatingTierUserId(null);
      toast.success('Tier updated');
    },
    onError: error => {
      setUpdatingTierUserId(null);
      toast.error(error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: mutating(deleteUser),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userQueries.key.list() });
      await queryClient.invalidateQueries({
        queryKey: userQueries.key.stats()
      });
      setDeleting(null);
      toast.success('User deleted');
    },
    onError: error => toast.error(error.message)
  });

  const columns = useMemo(
    () =>
      userColumns({
        quotaOptions,
        tierOptions,
        updatingRoleUserId,
        updatingQuotaUserId,
        updatingTierUserId,
        setRole: (user, role) => {
          setUpdatingRoleUserId(user.id);
          updateRoleMutation.mutate({ id: user.id, role });
        },
        setQuota: (user, quotaId) => {
          setUpdatingQuotaUserId(user.id);
          if (quotaId === QUOTA_NONE) {
            removeQuotaMutation.mutate({ userId: user.id });
          } else {
            setQuotaMutation.mutate({ userId: user.id, quotaId });
          }
        },
        setTier: (user, tierId) => {
          setUpdatingTierUserId(user.id);
          setTierMutation.mutate({
            id: user.id,
            tierId: tierId === TIER_NONE ? null : tierId
          });
        },
        remove: setDeleting
      }),
    [
      quotaOptions,
      tierOptions,
      updatingRoleUserId,
      updatingQuotaUserId,
      updatingTierUserId
    ]
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
        </ConsoleFilters>
        <div className="text-sm text-muted-foreground">
          {stats?.total || 0} total users, {stats?.admins || 0} admins.
        </div>
      </ConsoleToolbar>

      <DataTable
        columns={columns}
        data={isLoading ? undefined : data?.rows}
        empty={
          search ? 'No users found matching your search.' : 'No users found.'
        }
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

      <AlertDialog
        open={!!deleting}
        onOpenChange={open => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name || deleting?.email} and everything they own —
              chats, messages and files — are deleted. Their payments are kept,
              under the email they paid with. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                // Stays open while it deletes, and on a refusal.
                e.preventDefault();
                if (deleting) deleteMutation.mutate({ id: deleting.id });
              }}
              disabled={deleteMutation.isPending}
              variant="destructive"
              className="gap-2"
            >
              {deleteMutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
