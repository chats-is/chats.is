import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { mutating } from '@/lib/mutation';
import { modelQueries } from '@/server/fn/model';
import {
  createQuota,
  deleteQuota,
  quotaQueries,
  updateQuota,
  type listQuotas
} from '@/server/fn/quota';
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
import { Input } from '@/components/ui/input';
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
import { ConsoleTableSkeleton } from '@/components/console/skeletons';

type Quota = Awaited<ReturnType<typeof listQuotas>>[number];
type Role = 'strict' | 'standard' | 'flexible' | 'custom';

// 5h limit as a fraction of the weekly limit. Weekly is the anchor — admin
// enters a weekly budget and the role chooses how much of it a single 5h
// burst can consume. `custom` has no preset ratio — admin keeps whatever
// values are already stored, edits each separately.
const ROLE_RATIOS: Record<Exclude<Role, 'custom'>, number> = {
  strict: 0.1,
  standard: 0.15,
  flexible: 0.2
};

const ROLE_LABEL: Record<Role, string> = {
  strict: 'Strict (10%)',
  standard: 'Standard (15%)',
  flexible: 'Flexible (20%)',
  custom: 'Custom'
};

const ROLE_OPTIONS = (Object.keys(ROLE_LABEL) as Array<Role>).map(role => ({
  value: role,
  label: ROLE_LABEL[role]
}));

/** Tolerance for role detection. Anything within ±1% of a preset is "that". */
const ROLE_DETECT_TOLERANCE = 0.01;

/** A money field as typed: blank, or a non-negative number. */
const amount = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const quotaSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required'),
    description: z.string(),
    role: z.enum(['strict', 'standard', 'flexible', 'custom']),
    sevenDay: z.string(),
    // Editable only when role === 'custom'; derived from sevenDay otherwise.
    fiveHour: z.string(),
    isUnlimited: z.boolean(),
    allowedModelIds: z.array(z.string())
  })
  // The limits only have to make sense when the quota actually has limits, so
  // the rules sit here rather than on the two fields.
  .superRefine((value, ctx) => {
    if (value.isUnlimited) return;

    if (value.sevenDay.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['sevenDay'],
        message: 'Weekly limit is required (or toggle Unlimited)'
      });
    } else {
      const weekly = amount(value.sevenDay);
      if (weekly === null || weekly <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['sevenDay'],
          message: 'Weekly limit must be a positive number'
        });
      }
    }

    if (value.role === 'custom' && amount(value.fiveHour) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['fiveHour'],
        message: '5-hour limit must be a non-negative number'
      });
    }
  });

type QuotaForm = z.infer<typeof quotaSchema>;

const emptyForm: QuotaForm = {
  name: '',
  description: '',
  role: 'standard',
  sevenDay: '',
  fiveHour: '',
  isUnlimited: false,
  allowedModelIds: []
};

/** Detect which role matches the stored fiveHour/sevenDay ratio. Returns 'custom'
 *  if no preset is within tolerance. Empty/zero sevenDay → 'standard' (default). */
const detectRole = (fiveHour: string | null, sevenDay: string | null): Role => {
  const f = Number(fiveHour);
  const w = Number(sevenDay);
  if (!Number.isFinite(w) || w <= 0) return 'standard';
  if (!Number.isFinite(f)) return 'standard';
  const ratio = f / w;
  for (const key of ['strict', 'standard', 'flexible'] as const) {
    if (Math.abs(ratio - ROLE_RATIOS[key]) < ROLE_DETECT_TOLERANCE) {
      return key;
    }
  }
  return 'custom';
};

const fmtLimit = (v: string | null | undefined) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
};

const fmtAmount = (v: string | null): string => {
  if (v === null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2);
};

/** The 5-hour limit a form's values imply, in dollars. */
const fiveHourOf = (
  value: Pick<QuotaForm, 'role' | 'sevenDay' | 'fiveHour'>
) =>
  value.role === 'custom'
    ? amount(value.fiveHour)
    : (() => {
        const weekly = amount(value.sevenDay);
        return weekly === null ? null : weekly * ROLE_RATIOS[value.role];
      })();

const helper = createAppColumnHelper<Quota>();

const quotaColumns = (actions: {
  edit: (quota: Quota) => void;
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
          {row.original.isUnlimited && (
            <span className="mt-1 inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
              Unlimited
            </span>
          )}
        </>
      )
    }),
    helper.accessor('fiveHour', {
      header: '5h',
      meta: { align: 'right', cellClassName: 'font-mono text-sm' },
      cell: ({ row }) =>
        row.original.isUnlimited ? '∞' : fmtLimit(row.original.fiveHour)
    }),
    helper.accessor('sevenDay', {
      header: 'Weekly',
      meta: { align: 'right', cellClassName: 'font-mono text-sm' },
      cell: ({ row }) =>
        row.original.isUnlimited ? '∞' : fmtLimit(row.original.sevenDay)
    }),
    helper.accessor(row => row.allowedModelIds.length, {
      id: 'models',
      header: 'Models',
      meta: { align: 'center', cellClassName: 'text-sm' },
      cell: ({ row }) =>
        row.original.allowedModelIds.length === 0
          ? 'All'
          : `${row.original.allowedModelIds.length}`
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
                disabled={row.original.isDefault}
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

export default function QuotasPage() {
  const queryClient = useQueryClient();
  const { data: quotas, isLoading } = useQuery(quotaQueries.list());
  const { data: models } = useQuery(modelQueries.list());

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: quotaQueries.key.list() });
    queryClient.invalidateQueries({
      queryKey: quotaQueries.key.listForSelect()
    });
  };

  const create = useMutation({
    mutationFn: mutating(createQuota),
    onSuccess: () => {
      invalidate();
      toast.success('Quota created');
    }
  });

  const update = useMutation({
    mutationFn: mutating(updateQuota),
    onSuccess: () => {
      invalidate();
      toast.success('Quota saved');
    }
  });

  const del = useMutation({
    mutationFn: mutating(deleteQuota),
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
      toast.success('Quota deleted');
    },
    onError: e => toast.error(e.message)
  });

  const form = useAppForm({
    defaultValues: emptyForm,
    validators: { onChange: quotaSchema },
    onSubmit: async ({ value }) => {
      const payload = {
        name: value.name.trim(),
        description: value.description.trim() || null,
        fiveHour: value.isUnlimited ? null : fiveHourOf(value),
        sevenDay: value.isUnlimited ? null : amount(value.sevenDay),
        isUnlimited: value.isUnlimited,
        allowedModelIds: value.allowedModelIds
      };

      try {
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

  const openFor = (quota: Quota | null) => {
    setEditingId(quota?.id ?? null);
    form.reset(
      quota
        ? {
            name: quota.name,
            description: quota.description ?? '',
            role: detectRole(quota.fiveHour, quota.sevenDay),
            sevenDay: fmtAmount(quota.sevenDay),
            fiveHour: fmtAmount(quota.fiveHour),
            isUnlimited: quota.isUnlimited,
            allowedModelIds: quota.allowedModelIds ?? []
          }
        : emptyForm
    );
    setOpen(true);
  };

  const columns = useMemo(
    () => quotaColumns({ edit: openFor, remove: setDeleteId }),
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

  if (isLoading) {
    return <ConsoleTableSkeleton columns={5} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-4">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={() => openFor(null)}>
              <Plus className="size-4" />
              New Quota
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingId ? 'Edit Quota' : 'New Quota'}
              </DialogTitle>
              <DialogDescription>
                Configure usage caps and allowed models for this quota.
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
                <form.AppField name="name">
                  {field => (
                    <field.TextField
                      label="Name"
                      placeholder="Free, Pro, Team..."
                    />
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
                <form.AppField name="isUnlimited">
                  {field => <field.SwitchField label="Unlimited" />}
                </form.AppField>

                <form.Subscribe
                  selector={state => ({
                    role: state.values.role,
                    sevenDay: state.values.sevenDay,
                    fiveHour: state.values.fiveHour,
                    isUnlimited: state.values.isUnlimited
                  })}
                >
                  {values => (
                    <div className="grid grid-cols-3 gap-3">
                      <form.AppField name="role">
                        {field => (
                          <field.SelectField
                            label="Roles"
                            options={ROLE_OPTIONS}
                            disabled={values.isUnlimited}
                          />
                        )}
                      </form.AppField>
                      <form.AppField name="sevenDay">
                        {field => (
                          <field.TextField
                            label="Weekly"
                            inputMode="decimal"
                            placeholder="0.00"
                            prefix="$"
                            disabled={values.isUnlimited}
                          />
                        )}
                      </form.AppField>
                      {values.role === 'custom' ? (
                        <form.AppField name="fiveHour">
                          {field => (
                            <field.TextField
                              label="5-hour"
                              inputMode="decimal"
                              placeholder="0.00"
                              prefix="$"
                              disabled={values.isUnlimited}
                            />
                          )}
                        </form.AppField>
                      ) : (
                        // A preset role derives this from the weekly budget,
                        // so it is shown rather than edited.
                        <div className="space-y-2">
                          <Label>5-hour</Label>
                          <div className="relative">
                            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                              $
                            </span>
                            <Input
                              inputMode="decimal"
                              placeholder="0.00"
                              readOnly
                              tabIndex={-1}
                              value={fiveHourOf(values)?.toFixed(2) ?? ''}
                              disabled={values.isUnlimited}
                              className="pl-7"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </form.Subscribe>

                <form.Field name="allowedModelIds" mode="array">
                  {field => (
                    <div className="space-y-2">
                      <Label>
                        Allowed Models
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          If unchecked, all models are allowed.
                          {field.state.value.length > 0 &&
                            ` · ${field.state.value.length} selected`}
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
        data={quotas}
        empty="No quotas yet. Create one to start."
      />

      <AlertDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Quota</AlertDialogTitle>
            <AlertDialogDescription>
              Plans referencing this quota will block the delete. Confirm?
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
