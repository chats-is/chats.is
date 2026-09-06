import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Github,
  Loader2,
  Mail,
  Search,
  ShieldCheck,
  User as UserIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { mutating } from '@/lib/mutation';
import { quotaQueries, removeUserQuota, setUserQuota } from '@/server/fn/quota';
import { updateUserRole, userQueries, type listUsers } from '@/server/fn/user';
import { Input } from '@/components/ui/input';
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
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { IconGoogle } from '@/components/icons';

type User = Awaited<ReturnType<typeof listUsers>>[number];
type QuotaOption = { id: string; name: string; isUnlimited: boolean };

const ProviderIcon = ({ provider }: { provider: string }) => {
  switch (provider.toLowerCase()) {
    case 'github':
      return <Github className="size-4" />;
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

const formatDate = (date: Date | null) => {
  if (!date) return 'Never';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

const helper = createAppColumnHelper<User>();

/**
 * The role and quota cells write straight to the server, so the column list
 * needs the mutations and the per-row "which one is saving" flags.
 */
const userColumns = (ctx: {
  quotaOptions: Array<QuotaOption> | undefined;
  updatingRoleUserId: string | null;
  updatingQuotaUserId: string | null;
  setRole: (user: User, role: 'user' | 'admin') => void;
  setQuota: (user: User, quotaId: string) => void;
}) =>
  helper.columns([
    helper.accessor('name', {
      header: 'User',
      cell: ({ row }) => {
        const user = row.original;
        return (
          <Link
            to="/console/users/$userId"
            params={{ userId: user.id }}
            className="flex items-center gap-3 hover:text-primary"
          >
            <div className="size-8 overflow-hidden rounded-full border bg-muted">
              {user.image ? (
                <img
                  src={user.image}
                  alt={user.name || ''}
                  width={32}
                  height={32}
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center text-xs font-medium text-muted-foreground">
                  {user.name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
                </div>
              )}
            </div>
            <span className="font-medium">{user.name || 'No name'}</span>
          </Link>
        );
      }
    }),
    helper.accessor('email', {
      header: 'Email',
      meta: { cellClassName: 'text-sm text-muted-foreground' }
    }),
    helper.display({
      id: 'provider',
      header: 'Provider',
      meta: { headClassName: 'w-32' },
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
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
    helper.accessor(row => row.plan?.name, {
      id: 'plan',
      header: 'Plan',
      meta: {
        align: 'center',
        headClassName: 'w-28',
        cellClassName: 'text-sm'
      },
      cell: ({ row }) => (
        <span className={row.original.plan ? '' : 'text-muted-foreground'}>
          {row.original.plan?.name ?? 'Free'}
        </span>
      )
    }),
    helper.accessor('emailVerified', {
      header: 'Verified',
      meta: { headClassName: 'w-32', cellClassName: 'text-sm' },
      // Verification is a yes or no now, not a date: the auth library records
      // whether an address was confirmed, not when. The column always asked
      // "Verified".
      cell: ({ row }) =>
        row.original.emailVerified ? (
          <Check className="size-4 text-muted-foreground" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )
    }),
    helper.accessor('createdAt', {
      header: 'Joined',
      meta: { headClassName: 'w-32', cellClassName: 'text-sm' },
      cell: ({ row }) => formatDate(row.original.createdAt)
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
              <SelectTrigger className="h-8 w-28">
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
      meta: { align: 'center', headClassName: 'w-40' },
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
              <SelectTrigger className="h-8 w-36">
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
    })
  ]);

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(
    null
  );
  const [updatingQuotaUserId, setUpdatingQuotaUserId] = useState<string | null>(
    null
  );

  const queryClient = useQueryClient();
  const { data: users, isLoading } = useQuery(
    userQueries.list({
      search: search || undefined
    })
  );
  const { data: stats } = useQuery(userQueries.stats());
  const { data: quotaOptions } = useQuery(quotaQueries.listForSelect());

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

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchInput]);

  const columns = useMemo(
    () =>
      userColumns({
        quotaOptions,
        updatingRoleUserId,
        updatingQuotaUserId,
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
        }
      }),
    [quotaOptions, updatingRoleUserId, updatingQuotaUserId]
  );

  if (isLoading) {
    return <ConsoleTableSkeleton columns={8} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex max-w-2xl flex-1 items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          {stats?.total || 0} total users, {stats?.admins || 0} admins.
        </div>
      </div>

      <DataTable
        columns={columns}
        data={users}
        empty={
          search ? 'No users found matching your search.' : 'No users found.'
        }
      />
    </div>
  );
}
