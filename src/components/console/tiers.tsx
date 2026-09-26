import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { describeMultiplier } from '@/lib/billing';
import { describeModelList } from '@/lib/model-access';
import { mutating } from '@/lib/mutation';
import { useEditRecord } from '@/hooks/use-edit-record';
import { useSearchFilter } from '@/hooks/use-search-filter';
import { modelQueries } from '@/server/functions/model';
import { planQueries } from '@/server/functions/plan';
import {
  createTier,
  deleteTier,
  getTier,
  tierQueries,
  updateTier,
  type listTiers
} from '@/server/functions/tier';
import { userQueries } from '@/server/functions/user';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
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
import { ModelStatusBadge } from '@/components/console/model-status';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { tierTableInput } from '@/components/console/table-filters';
import { ConsoleFilters, ConsoleToolbar } from '@/components/console/toolbar';

type Tier = Awaited<ReturnType<typeof listTiers>>['rows'][number];
/** What the edit form is filled from: the tier as read when it opens. */
type EditableTier = NonNullable<Awaited<ReturnType<typeof getTier>>>;

const tierSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().max(500),
  priceMultiplier: z
    .string()
    .trim()
    .min(1, 'Multiplier is required')
    .refine(
      v => Number.isFinite(Number(v)) && Number(v) > 0,
      'Multiplier must be a number above 0'
    ),
  modelRestrictionMode: z.enum(['allow', 'deny']),
  modelIds: z.array(z.string())
});

type TierForm = z.infer<typeof tierSchema>;

// A new tier starts at 1 — the cost price — so the required field is never
// blank until someone clears it, and clearing it is what shows the error.
const emptyForm: TierForm = {
  name: '',
  description: '',
  priceMultiplier: '1',
  modelRestrictionMode: 'allow',
  modelIds: []
};

/** The two ways a tier restricts models. */
const MODEL_RESTRICTION_MODES = [
  { value: 'allow', label: 'Allowed models' },
  { value: 'deny', label: 'Blocked models' }
];

const helper = createAppColumnHelper<Tier>();

const tierColumns = (actions: {
  edit: (tier: Tier) => void;
  remove: (id: string) => void;
}) =>
  helper.columns([
    helper.accessor('name', {
      header: 'Name',
      // Held at one width across the quotas, plans and tiers tables, so the
      // name sits in the same place on each.
      meta: { headClassName: 'w-56 min-w-56' },
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
    helper.accessor('priceMultiplier', {
      header: 'Price',
      meta: { headClassName: 'w-24', cellClassName: 'text-sm tabular-nums' },
      cell: ({ row }) => describeMultiplier(row.original.priceMultiplier)
    }),
    helper.accessor(row => describeModelList(row), {
      id: 'models',
      header: 'Models',
      // The one column left to take up the width: a list of ids is the
      // widest thing here.
      meta: { cellClassName: 'text-sm' },
      // The mode as a word, and the models by id: what the tier lets through
      // is read off the row, not opened for.
      cell: ({ row }) =>
        row.original.modelIds.length === 0 ? (
          <span className="text-muted-foreground">All</span>
        ) : (
          <>
            <div className="font-medium">
              {row.original.modelRestrictionMode === 'allow'
                ? 'Allowed'
                : 'Blocked'}
            </div>
            <div className="font-mono text-xs break-all text-muted-foreground">
              {row.original.modelIds.join(', ')}
            </div>
          </>
        )
    }),
    helper.accessor('planCount', {
      header: 'Plans',
      meta: { align: 'center', headClassName: 'w-20', cellClassName: 'text-sm' }
    }),
    helper.accessor('userCount', {
      header: 'Users',
      meta: { align: 'center', headClassName: 'w-20', cellClassName: 'text-sm' }
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

/** Stands in for the row actions, which a placeholder row can never call. */
const noop = () => {};

/** The page while its first rows are on their way — see `PlansPending`. */
export function TiersPending() {
  return (
    <ConsoleTableSkeleton
      columns={tierColumns({ edit: noop, remove: noop })}
      search={false}
    />
  );
}

/**
 * Tiers: what a plan or a user is entitled to — the price multiplier they
 * are charged at and the models they may use. A handful of named steps,
 * chosen from, rather than a number and a list typed on every plan.
 */
export default function TiersPage() {
  const [page, setPage] = useSearchFilter('page', 1);

  const queryClient = useQueryClient();
  const { data, isLoading, isPlaceholderData } = useQuery(
    tierQueries.list(tierTableInput({ page }))
  );
  const { data: models } = useQuery(modelQueries.forSelect());
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // A tier's name and multiplier show on the plans and the users that chose
  // it, so those lists are stale once one is written.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: tierQueries.all() });
    queryClient.invalidateQueries({ queryKey: planQueries.key.list() });
    queryClient.invalidateQueries({ queryKey: userQueries.key.detail() });
  };

  const create = useMutation({
    mutationFn: mutating(createTier),
    onSuccess: () => {
      invalidate();
      toast.success('Tier created');
    }
  });

  const update = useMutation({
    mutationFn: mutating(updateTier),
    onSuccess: () => {
      invalidate();
      toast.success('Tier saved');
    }
  });

  const del = useMutation({
    mutationFn: mutating(deleteTier),
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
      toast.success('Tier deleted');
    },
    onError: e => toast.error(e.message)
  });

  const [defaults, setDefaults] = useState(emptyForm);

  const form = useAppForm({
    defaultValues: defaults,
    validators: { onChange: tierSchema },
    onSubmit: async ({ value }) => {
      const payload = {
        name: value.name.trim(),
        description: value.description.trim() || null,
        priceMultiplier: value.priceMultiplier.trim(),
        modelRestrictionMode: value.modelRestrictionMode,
        modelIds: value.modelIds
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
  const openFor = (tier: EditableTier | null) => {
    setEditingId(tier?.id ?? null);
    const values = tier
      ? {
          name: tier.name,
          description: tier.description ?? '',
          // Stored to four places, shown as typed: 1.5, not 1.5000.
          priceMultiplier: String(Number(tier.priceMultiplier)),
          modelRestrictionMode: tier.modelRestrictionMode,
          modelIds: tier.modelIds ?? []
        }
      : emptyForm;
    setDefaults(values);
    form.reset(values);
    setOpen(true);
  };

  // Editing opens the form on the row as the table shows it, held, and fills
  // it again from the tier as read now — then it can be typed in.
  const record = useEditRecord(
    id => getTier({ data: { id } }),
    'tier',
    () => setOpen(false)
  );
  // Every way out of the dialog: a read still out for it is no longer wanted.
  const close = () => {
    record.cancel();
    setOpen(false);
  };
  const openEdit = async (shown: Tier) => {
    openFor(shown);
    const tier = await record.load(shown.id);
    if (tier) openFor(tier);
  };

  const columns = useMemo(
    () => tierColumns({ edit: openEdit, remove: setDeleteId }),
    []
  );

  const modelsByCapability = useMemo(() => {
    const groups: Record<string, NonNullable<typeof models>> = {};
    (models ?? []).forEach(m => {
      const cap = m.capability;
      if (!groups[cap]) groups[cap] = [];
      groups[cap].push(m);
    });
    return groups;
  }, [models]);

  return (
    <div className="space-y-6">
      <ConsoleToolbar>
        <ConsoleFilters />
        <Dialog
          open={open}
          onOpenChange={open => (open ? setOpen(true) : close())}
        >
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={() => openFor(null)}>
              <Plus className="size-4" />
              New Tier
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Tier' : 'New Tier'}</DialogTitle>
              <DialogDescription>
                A tier is what plans and users are put on: the price they are
                charged at — the cost price times the multiplier; the lower, the
                cheaper, 0.5 is half price, 2 double — and the models they may
                use.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={e => {
                e.preventDefault();
                form.handleSubmit();
              }}
              className="space-y-4"
            >
              <fieldset
                disabled={record.isLoading}
                className="-mx-6 max-h-[60vh] min-w-0 space-y-4 overflow-y-auto px-6"
              >
                <form.AppField name="name">
                  {field => (
                    <field.TextField label="Name" placeholder="Tier1" />
                  )}
                </form.AppField>
                <form.AppField name="description">
                  {field => (
                    <field.TextareaField
                      label="Description (optional)"
                      rows={2}
                    />
                  )}
                </form.AppField>
                <form.AppField name="priceMultiplier">
                  {field => (
                    <field.TextField
                      label="Price multiplier"
                      type="number"
                      min={0.01}
                      step="0.01"
                      hint="Charged = cost price × multiplier. 0.5 is half price, 1 the cost price, 1.5 one and a half times, 2 double. Must be above 0: nothing is free."
                    />
                  )}
                </form.AppField>
                <form.AppField name="modelRestrictionMode">
                  {field => (
                    <field.SelectField
                      label="Models"
                      options={MODEL_RESTRICTION_MODES}
                      hint="Allowed models: only the checked models can be used. Blocked models: the checked models cannot be used, every other one can. Nothing checked: every model can be used."
                    />
                  )}
                </form.AppField>
                <form.Field name="modelIds" mode="array">
                  {field => (
                    <div className="space-y-2">
                      <Label>
                        <span className="text-xs font-normal text-muted-foreground">
                          {field.state.value.length === 0
                            ? 'Nothing checked: all models are allowed.'
                            : `${field.state.value.length} checked`}
                        </span>
                      </Label>
                      <div className="max-h-64 overflow-auto rounded-md border p-3">
                        {Object.keys(modelsByCapability).length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            No models configured.
                          </div>
                        ) : (
                          Object.entries(modelsByCapability).map(
                            ([cap, items]) => (
                              <div key={cap} className="mb-3 last:mb-0">
                                <div className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                                  {cap}
                                </div>
                                <div className="grid grid-cols-2 gap-1">
                                  {items.map(m => (
                                    <label
                                      key={m.id}
                                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/40"
                                    >
                                      <Checkbox
                                        checked={field.state.value.includes(
                                          m.modelId
                                        )}
                                        onCheckedChange={() =>
                                          field.handleChange(current =>
                                            current.includes(m.modelId)
                                              ? current.filter(
                                                  id => id !== m.modelId
                                                )
                                              : [...current, m.modelId]
                                          )
                                        }
                                      />
                                      <span className="truncate font-mono text-xs">
                                        {m.modelId}
                                      </span>
                                      <ModelStatusBadge status={m.status} />
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )
                          )
                        )}
                      </div>
                    </div>
                  )}
                </form.Field>
              </fieldset>
              <DialogFooter>
                <form.Subscribe selector={state => state.isSubmitting}>
                  {isSubmitting => (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={close}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                  )}
                </form.Subscribe>
                <form.AppForm>
                  <form.SubmitButton disabled={record.isLoading}>
                    {editingId ? 'Save Changes' : 'Create'}
                  </form.SubmitButton>
                </form.AppForm>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </ConsoleToolbar>

      <DataTable
        columns={columns}
        data={isLoading ? undefined : data?.rows}
        empty="No tiers yet. A tier sets a price multiplier over the cost price — 0.5 is half price, 2 double — and the models allowed. Without one, every user is charged the cost price and may use every model."
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
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tier</AlertDialogTitle>
            <AlertDialogDescription>
              A tier still chosen by a plan or a user cannot be deleted.
              Continue?
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
