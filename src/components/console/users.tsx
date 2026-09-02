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
import { onSelect } from '@/lib/select';
import { quotaQueries, removeUserQuota, setUserQuota } from '@/server/fn/quota';
import { updateUserRole, userQueries } from '@/server/fn/user';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { IconGoogle } from '@/components/icons';

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

  const formatDate = (date: Date | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Base UI's trigger renders the value, not the selected item's content, so
  // the value-to-label mapping is handed to it.
  const quotaLabels = useMemo(
    () => ({
      [QUOTA_NONE]: 'None',
      ...Object.fromEntries(
        (quotaOptions ?? []).map(q => [
          q.id,
          q.name + (q.isUnlimited ? ' (∞)' : '')
        ])
      )
    }),
    [quotaOptions]
  );

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        Loading...
      </div>
    );
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

      <div className="rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 text-left text-sm font-medium">User</th>
              <th className="p-3 text-left text-sm font-medium">Email</th>
              <th className="w-32 p-3 text-left text-sm font-medium">
                Provider
              </th>
              <th className="w-28 p-3 text-center text-sm font-medium">Plan</th>
              <th className="w-32 p-3 text-left text-sm font-medium">
                Verified
              </th>
              <th className="w-32 p-3 text-left text-sm font-medium">Joined</th>
              <th className="w-32 p-3 text-center text-sm font-medium">Role</th>
              <th className="w-40 p-3 text-center text-sm font-medium">
                Quota
              </th>
            </tr>
          </thead>
          <tbody>
            {users?.map(user => (
              <tr
                key={user.id}
                className="border-b transition-colors hover:bg-muted/30"
              >
                <td className="p-3">
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
                          {user.name?.[0]?.toUpperCase() ||
                            user.email[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <span className="font-medium">
                      {user.name || 'No name'}
                    </span>
                  </Link>
                </td>
                <td className="p-3 text-sm text-muted-foreground">
                  {user.email}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    {user.accounts && user.accounts.length > 0 ? (
                      user.accounts.map((account, idx) => (
                        <ProviderIcon key={idx} provider={account.providerId} />
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </div>
                </td>
                <td className="p-3 text-center text-sm">
                  <span className={user.plan ? '' : 'text-muted-foreground'}>
                    {user.plan?.name ?? 'Free'}
                  </span>
                </td>
                <td className="p-3 text-sm">
                  {/* Verification is a yes or no now, not a date: the auth
                      library records whether an address was confirmed, not
                      when. The column always asked "Verified". */}
                  {user.emailVerified ? (
                    <Check className="size-4 text-muted-foreground" />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="p-3 text-sm">{formatDate(user.createdAt)}</td>
                <td className="p-3 text-center">
                  <div className="flex justify-center">
                    <Select
                      value={user.role}
                      disabled={updatingRoleUserId === user.id}
                      onValueChange={onSelect(value => {
                        setUpdatingRoleUserId(user.id);
                        updateRoleMutation.mutate({
                          id: user.id,
                          role: value as 'user' | 'admin'
                        });
                      })}
                    >
                      <SelectTrigger className="h-8 w-28">
                        <div className="flex items-center gap-2">
                          {updatingRoleUserId === user.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : user.role === 'admin' ? (
                            <ShieldCheck className="size-3" />
                          ) : (
                            <UserIcon className="size-3" />
                          )}
                          <span>
                            {user.role === 'admin' ? 'Admin' : 'User'}
                          </span>
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
                </td>
                <td className="p-3 text-center">
                  <div className="flex justify-center">
                    <Select
                      items={quotaLabels}
                      value={user.quota?.id ?? QUOTA_NONE}
                      disabled={
                        updatingQuotaUserId === user.id || !quotaOptions?.length
                      }
                      onValueChange={onSelect(value => {
                        setUpdatingQuotaUserId(user.id);
                        if (value === QUOTA_NONE) {
                          removeQuotaMutation.mutate({ userId: user.id });
                        } else {
                          setQuotaMutation.mutate({
                            userId: user.id,
                            quotaId: value
                          });
                        }
                      })}
                    >
                      <SelectTrigger className="h-8 w-36">
                        {updatingQuotaUserId === user.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <SelectValue placeholder="None" />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={QUOTA_NONE}>
                          <span className="text-muted-foreground">None</span>
                        </SelectItem>
                        {quotaOptions?.map(q => (
                          <SelectItem key={q.id} value={q.id}>
                            {q.name}
                            {q.isUnlimited ? ' (∞)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </td>
              </tr>
            ))}
            {(!users || users.length === 0) && (
              <tr>
                <td
                  colSpan={8}
                  className="p-6 text-center text-muted-foreground"
                >
                  {search
                    ? 'No users found matching your search.'
                    : 'No users found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
