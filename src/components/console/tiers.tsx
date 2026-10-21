import { Fragment, useMemo, useState } from 'react';
import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { type ModelCapability } from '@/types';
import { describeMultiplier } from '@/lib/billing';
import { CAPABILITIES, MEDIA_KIND_LABELS } from '@/lib/constant';
import { describeModelList } from '@/lib/model-access';
import { mutating } from '@/lib/mutation';
import { cn, isSttModel, isTtsModel } from '@/lib/utils';
import { useEditRecord } from '@/hooks/use-edit-record';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  modelQueries,
  type listModelsForSelect
} from '@/server/functions/model';
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
import { ModelStatusName } from '@/components/console/model-status-name';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { tierTableInput } from '@/components/console/table-filters';
import { ConsoleFilters, ConsoleToolbar } from '@/components/console/toolbar';
import { ModelIcon } from '@/components/model-icon';

type Tier = Awaited<ReturnType<typeof listTiers>>['rows'][number];
type ConsoleModel = Awaited<ReturnType<typeof listModelsForSelect>>[number];
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
  model: (modelId: string) => ConsoleModel | undefined;
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
      header: 'Price multiplier',
      meta: {
        headClassName: 'w-36',
        cellClassName: 'text-sm tabular-nums whitespace-nowrap'
      },
      cell: ({ row }) => describeMultiplier(row.original.priceMultiplier)
    }),
    helper.accessor(row => describeModelList(row), {
      id: 'models',
      header: 'Models',
      // The one column left to take up the width: a list of ids is the
      // widest thing here.
      meta: { cellClassName: 'text-sm' },
      // The mode as a word, and the models by id: what the tier lets through
      // is read off the row, not opened for. Each says whether it answers,
      // as the console names a model everywhere.
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
              {row.original.modelIds.map((modelId, index) => {
                const model = actions.model(modelId);
                return (
                  <Fragment key={modelId}>
                    {index > 0 && ', '}
                    {model ? (
                      <ModelStatusName status={model.status}>
                        {modelId}
                      </ModelStatusName>
                    ) : (
                      modelId
                    )}
                  </Fragment>
                );
              })}
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
      columns={tierColumns({
        model: () => undefined,
        edit: noop,
        remove: noop
      })}
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
  const model = (modelId: string) =>
    models?.find(each => each.modelId === modelId);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // The groups of the model list folded away, by name.
  const [folded, setFolded] = useState<string[]>([]);

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
    () => tierColumns({ model, edit: openEdit, remove: setDeleteId }),
    [models]
  );

  // What the models are for, by the names the app gives them elsewhere —
  // audio split, as the media generation settings split it, into speaking
  // and transcribing — each in the order the console sets.
  const modelGroups = useMemo(() => {
    const named = (capability: ModelCapability) =>
      CAPABILITIES.find(({ value }) => value === capability)!.label;
    const all = models ?? [];
    return [
      {
        label: named('chat'),
        models: all.filter(m => m.capability === 'chat')
      },
      {
        label: named('image'),
        models: all.filter(m => m.capability === 'image')
      },
      {
        label: named('video'),
        models: all.filter(m => m.capability === 'video')
      },
      { label: MEDIA_KIND_LABELS.audio, models: all.filter(isTtsModel) },
      { label: MEDIA_KIND_LABELS.stt, models: all.filter(isSttModel) }
    ].filter(group => group.models.length > 0);
  }, [models]);

  // What a checked model is, under the mode in force: allowed or blocked.
  const restriction = useStore(
    form.store,
    state => state.values.modelRestrictionMode
  );

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
                Set the price multiplier and which models users on this tier may
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
                      hint="Charged = cost price × multiplier. 1 charges the cost price as is; 0.5 is half price, 2 double. Must be above 0."
                    />
                  )}
                </form.AppField>
                <form.AppField name="modelRestrictionMode">
                  {field => (
                    <field.SelectField
                      label="Models"
                      options={MODEL_RESTRICTION_MODES}
                      hint="Allowed: only the checked models can be used. Blocked: every model but the checked ones can be used."
                    />
                  )}
                </form.AppField>
                <form.Field name="modelIds" mode="array">
                  {field => {
                    const checked = field.state.value;
                    const check = (ids: string[], on: boolean) =>
                      field.handleChange(current =>
                        on
                          ? [...new Set([...current, ...ids])]
                          : current.filter(id => !ids.includes(id))
                      );
                    return (
                      <div className="space-y-2">
                        <Label>
                          <span className="text-xs font-normal text-muted-foreground">
                            {checked.length === 0
                              ? 'Nothing checked: all models are allowed.'
                              : describeModelList({
                                  modelRestrictionMode: restriction,
                                  modelIds: checked
                                })}
                          </span>
                        </Label>
                        {/* At its full length, scrolled with the form rather
                            than in a box of its own inside it. */}
                        <div className="rounded-md border p-3">
                          {modelGroups.length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                              No models configured.
                            </div>
                          ) : (
                            modelGroups.map(group => {
                              const ids = group.models.map(m => m.modelId);
                              const all = ids.every(id => checked.includes(id));
                              return (
                                <div
                                  key={group.label}
                                  className="mb-3 last:mb-0"
                                >
                                  {/* The whole group at once: checked once
                                      every model in it is, and unchecking it
                                      lets them all go. */}
                                  <div className="mb-1 flex items-center gap-2 px-2">
                                    <label className="flex cursor-pointer items-center gap-2">
                                      <Checkbox
                                        aria-label={`All ${group.label} models`}
                                        checked={all}
                                        onCheckedChange={on =>
                                          check(ids, on === true)
                                        }
                                      />
                                      <span className="text-xs font-semibold text-muted-foreground select-none">
                                        {group.label}
                                      </span>
                                    </label>
                                    <button
                                      type="button"
                                      aria-expanded={
                                        !folded.includes(group.label)
                                      }
                                      aria-label={`${folded.includes(group.label) ? 'Show' : 'Hide'} ${group.label} models`}
                                      onClick={() =>
                                        setFolded(current =>
                                          current.includes(group.label)
                                            ? current.filter(
                                                label => label !== group.label
                                              )
                                            : [...current, group.label]
                                        )
                                      }
                                      className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted"
                                    >
                                      <ChevronDown
                                        className={cn(
                                          'size-4 transition-transform',
                                          folded.includes(group.label) &&
                                            '-rotate-90'
                                        )}
                                      />
                                    </button>
                                  </div>
                                  <div
                                    className={cn(
                                      'grid grid-cols-2 gap-1',
                                      folded.includes(group.label) && 'hidden'
                                    )}
                                  >
                                    {group.models.map(m => (
                                      <label
                                        key={m.id}
                                        className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 hover:bg-muted/40"
                                      >
                                        <Checkbox
                                          className="mt-0.5"
                                          checked={checked.includes(m.modelId)}
                                          onCheckedChange={on =>
                                            check([m.modelId], on === true)
                                          }
                                        />
                                        {/* A slot of its own, so a model with
                                            no mark starts its name where the
                                            others do. */}
                                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                                          <ModelIcon
                                            image={
                                              m.image ||
                                              m.providers[0]?.provider?.image ||
                                              null
                                            }
                                            className="size-4"
                                          />
                                        </span>
                                        <span className="flex min-w-0 flex-col">
                                          <ModelStatusName
                                            status={m.status}
                                            className="text-sm"
                                          >
                                            {m.name}
                                          </ModelStatusName>
                                          <span
                                            className={cn(
                                              'truncate text-xs text-muted-foreground',
                                              m.status !== 'available' &&
                                                'line-through'
                                            )}
                                          >
                                            {m.modelId}
                                          </span>
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  }}
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
        empty="No tiers yet."
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
              Delete this tier? A tier used by a plan, a user or as the default
              cannot be deleted.
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
