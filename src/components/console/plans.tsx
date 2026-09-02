import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { mutating } from '@/lib/mutation';
import {
  createPlan,
  deletePlan,
  planQueries,
  updatePlan
} from '@/server/fn/plan';
import { quotaQueries } from '@/server/fn/quota';
import { userQueries } from '@/server/fn/user';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

type FormState = {
  name: string;
  description: string;
  quotaId: string;
  displayOrder: string;
};

const emptyForm: FormState = {
  name: '',
  description: '',
  quotaId: '',
  displayOrder: '0'
};

export default function PlansPage() {
  const queryClient = useQueryClient();
  const { data: plans, isLoading } = useQuery(planQueries.list());
  const { data: quotaOptions } = useQuery(quotaQueries.listForSelect());
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: mutating(createPlan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planQueries.key.list() });
      setOpen(false);
      setForm(emptyForm);
      toast.success('Plan created');
    },
    onError: e => toast.error(e.message)
  });

  const update = useMutation({
    mutationFn: mutating(updatePlan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planQueries.key.list() });
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success('Plan saved');
    },
    onError: e => toast.error(e.message)
  });

  const del = useMutation({
    mutationFn: mutating(deletePlan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planQueries.key.list() });
      queryClient.invalidateQueries({ queryKey: userQueries.key.list() });
      setDeleteId(null);
      toast.success('Plan deleted');
    },
    onError: e => toast.error(e.message)
  });

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setForm(emptyForm);
    }
  }, [open]);

  const startEdit = (plan: NonNullable<typeof plans>[number]) => {
    setEditingId(plan.id);
    setForm({
      name: plan.name,
      description: plan.description ?? '',
      quotaId: plan.quotaId,
      displayOrder: plan.displayOrder.toString()
    });
    setOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.quotaId) {
      toast.error('Please select a quota');
      return;
    }
    const displayOrder = Number(form.displayOrder) || 0;
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      quotaId: form.quotaId,
      displayOrder
    };

    if (editingId) {
      update.mutate({ id: editingId, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  const isPending = create.isPending || update.isPending;

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-4">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button
                className="gap-2"
                disabled={!quotaOptions?.length}
                title={
                  !quotaOptions?.length ? 'Create a Quota first' : undefined
                }
              >
                <Plus className="size-4" />
                New Plan
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Plan' : 'New Plan'}</DialogTitle>
              <DialogDescription>
                A plan is a named tier that references a Quota.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="-mx-6 max-h-[60vh] space-y-4 overflow-y-auto px-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="Pro"
                      required
                      disabled={isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Order</Label>
                    <Input
                      type="number"
                      value={form.displayOrder}
                      onChange={e =>
                        setForm({ ...form, displayOrder: e.target.value })
                      }
                      disabled={isPending}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description (optional)</Label>
                  <Textarea
                    value={form.description}
                    onChange={e =>
                      setForm({ ...form, description: e.target.value })
                    }
                    rows={2}
                    disabled={isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Quota</Label>
                  <Select
                    value={form.quotaId}
                    onValueChange={v => setForm({ ...form, quotaId: v })}
                    disabled={isPending}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a quota" />
                    </SelectTrigger>
                    <SelectContent>
                      {quotaOptions?.map(q => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.name}
                          {q.isUnlimited ? ' (Unlimited)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending} className="gap-2">
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  {editingId ? 'Save Changes' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 text-left text-sm font-medium">Name</th>
              <th className="p-3 text-left text-sm font-medium">Quota</th>
              <th className="p-3 text-center text-sm font-medium">Users</th>
              <th className="w-24 p-3 text-right text-sm font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {plans?.map(plan => (
              <tr
                key={plan.id}
                className="border-b transition-colors hover:bg-muted/30"
              >
                <td className="p-3">
                  <div className="font-medium">{plan.name}</div>
                  {plan.description && (
                    <div className="text-xs text-muted-foreground">
                      {plan.description}
                    </div>
                  )}
                </td>
                <td className="p-3 text-sm">
                  <div className="font-medium">{plan.quota?.name}</div>
                  {plan.quota?.isUnlimited && (
                    <span className="mt-1 inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
                      Unlimited
                    </span>
                  )}
                </td>
                <td className="p-3 text-center text-sm">{plan.userCount}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(plan)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>Edit</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(plan.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
                </td>
              </tr>
            ))}
            {(!plans || plans.length === 0) && (
              <tr>
                <td
                  colSpan={4}
                  className="p-6 text-center text-muted-foreground"
                >
                  No plans yet. Create a Quota first, then add a plan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Plan</AlertDialogTitle>
            <AlertDialogDescription>
              Users on this plan will fall back to the default quota. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && del.mutate({ id: deleteId })}
              disabled={del.isPending}
              variant="destructive"
              className="gap-2"
            >
              {del.isPending && <Loader2 className="size-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
