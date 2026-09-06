import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { mutating } from '@/lib/mutation';
import {
  createPlan,
  deletePlan,
  planQueries,
  updatePlan,
  type listPlans
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useAppForm } from '@/components/app-form';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';

type Plan = Awaited<ReturnType<typeof listPlans>>[number];

const planSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string(),
  quotaId: z.string().min(1, 'Select a quota'),
  displayOrder: z.string()
});

type PlanForm = z.infer<typeof planSchema>;

const emptyForm: PlanForm = {
  name: '',
  description: '',
  quotaId: '',
  displayOrder: '0'
};

const helper = createAppColumnHelper<Plan>();

const planColumns = (actions: {
  edit: (plan: Plan) => void;
  remove: (id: string) => void;
}) =>
  helper.columns([
    helper.accessor('name', {
      header: 'Name',
      cell: ({ row }) => (
        <>
          <div className="font-medium">{row.original.name}</div>
          {row.original.description && (
            <div className="text-xs text-muted-foreground">
              {row.original.description}
            </div>
          )}
        </>
      )
    }),
    helper.accessor(row => row.quota?.name, {
      id: 'quota',
      header: 'Quota',
      cell: ({ row }) => (
        <div className="text-sm">
          <div className="font-medium">{row.original.quota?.name}</div>
          {row.original.quota?.isUnlimited && (
            <span className="mt-1 inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
              Unlimited
            </span>
          )}
        </div>
      )
    }),
    helper.accessor('userCount', {
      header: 'Users',
      meta: { align: 'center', cellClassName: 'text-sm' }
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => actions.edit(row.original)}
              >
                <Pencil className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => actions.remove(row.original.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </>
      )
    })
  ]);

export default function PlansPage() {
  const queryClient = useQueryClient();
  const { data: plans, isLoading } = useQuery(planQueries.list());
  const { data: quotaOptions } = useQuery(quotaQueries.listForSelect());
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: mutating(createPlan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planQueries.key.list() });
      toast.success('Plan created');
    }
  });

  const update = useMutation({
    mutationFn: mutating(updatePlan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planQueries.key.list() });
      toast.success('Plan saved');
    }
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

  const [defaults, setDefaults] = useState(emptyForm);

  const form = useAppForm({
    defaultValues: defaults,
    validators: { onChange: planSchema },
    onSubmit: async ({ value }) => {
      const payload = {
        name: value.name.trim(),
        description: value.description.trim() || null,
        quotaId: value.quotaId,
        displayOrder: Number(value.displayOrder) || 0
      };

      try {
        // Awaited so the form stays in its submitting state — and so the
        // dialog closes only once the write has actually landed.
        if (editingId) {
          await update.mutateAsync({ id: editingId, ...payload });
        } else {
          await create.mutateAsync(payload);
        }
        setOpen(false);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  });

  // The dialog is a single form reused for "new" and "edit", so opening it is
  // what decides which record it is pointed at.
  const openFor = (plan: Plan | null) => {
    setEditingId(plan?.id ?? null);
    const values = plan
      ? {
          name: plan.name,
          description: plan.description ?? '',
          quotaId: plan.quotaId,
          displayOrder: plan.displayOrder.toString()
        }
      : emptyForm;
    setDefaults(values);
    form.reset(values);
    setOpen(true);
  };

  const columns = useMemo(
    () => planColumns({ edit: openFor, remove: setDeleteId }),
    []
  );

  const quotaSelectOptions = useMemo(
    () => (quotaOptions ?? []).map(q => ({ value: q.id, label: q.name })),
    [quotaOptions]
  );

  if (isLoading) {
    return <ConsoleTableSkeleton columns={4} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-4">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              className="gap-2"
              disabled={!quotaOptions?.length}
              title={!quotaOptions?.length ? 'Create a Quota first' : undefined}
              onClick={() => openFor(null)}
            >
              <Plus className="size-4" />
              New Plan
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Plan' : 'New Plan'}</DialogTitle>
              <DialogDescription>
                A plan is a named tier that references a Quota.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={e => {
                e.preventDefault();
                form.handleSubmit();
              }}
              className="space-y-4"
            >
              <div className="-mx-6 max-h-[60vh] space-y-4 overflow-y-auto px-6">
                <div className="grid grid-cols-2 gap-4">
                  <form.AppField name="name">
                    {field => (
                      <field.TextField label="Name" placeholder="Pro" />
                    )}
                  </form.AppField>
                  <form.AppField name="displayOrder">
                    {field => (
                      <field.TextField label="Display Order" type="number" />
                    )}
                  </form.AppField>
                </div>
                <form.AppField name="description">
                  {field => (
                    <field.TextareaField
                      label="Description (optional)"
                      rows={2}
                    />
                  )}
                </form.AppField>
                <form.AppField name="quotaId">
                  {field => (
                    <field.SelectField
                      label="Quota"
                      placeholder="Select a quota"
                      options={quotaSelectOptions}
                    />
                  )}
                </form.AppField>
              </div>
              <DialogFooter>
                <form.Subscribe selector={state => state.isSubmitting}>
                  {isSubmitting => (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOpen(false)}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                  )}
                </form.Subscribe>
                <form.AppForm>
                  <form.SubmitButton>
                    {editingId ? 'Save Changes' : 'Create'}
                  </form.SubmitButton>
                </form.AppForm>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <DataTable
        columns={columns}
        data={plans}
        empty="No plans yet. Create a Quota first, then add a plan."
      />

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
