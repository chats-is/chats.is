import { useMemo, useState } from 'react';
import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import {
  BILLING_TYPES,
  billingTypeSchema,
  intervalsOf,
  PAYMENT_PROCESSORS,
  paymentProcessorSchema,
  type BillingInterval,
  type PaymentProcessorId
} from '@/types/payment';
import { describeMultiplier } from '@/lib/billing';
import { formatPrice } from '@/lib/format-amount';
import { mutating } from '@/lib/mutation';
import { useEditRecord } from '@/hooks/use-edit-record';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  createPlan,
  deletePlan,
  getPlan,
  lookupPlanPrice,
  planQueries,
  setPlanEnabled,
  updatePlan,
  type listPlans
} from '@/server/functions/plan';
import { quotaQueries } from '@/server/functions/quota';
import { tierQueries } from '@/server/functions/tier';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
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
import { planTableInput } from '@/components/console/table-filters';
import { TierLabel } from '@/components/console/tier-label';
import { ConsoleFilters, ConsoleToolbar } from '@/components/console/toolbar';

type Plan = Awaited<ReturnType<typeof listPlans>>['rows'][number];
/** What the edit form is filled from: the plan as read when it opens. */
type EditablePlan = NonNullable<Awaited<ReturnType<typeof getPlan>>>;

/** The select's value for a plan on no tier: the cost price, every model. */
const NO_TIER = '__none__';

/** A price as typed: dollars, to the cent at most. */
const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

const planSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    description: z.string().max(500),
    quotaId: z.string().min(1, 'Select a quota'),
    tierId: z.string(),
    displayOrder: z.string(),
    billingType: billingTypeSchema,
    processor: paymentProcessorSchema,
    monthlyPrice: z.string(),
    monthlyPriceId: z.string(),
    yearlyPrice: z.string(),
    yearlyPriceId: z.string()
  })
  // Only the intervals the billing type sells at need their price and ID.
  .superRefine((form, ctx) => {
    for (const interval of intervalsOf(form.billingType)) {
      const name = interval === 'month' ? 'monthly' : 'yearly';
      const price = form[`${name}Price`].trim();
      if (!PRICE_PATTERN.test(price) || Number(price) <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: [`${name}Price`],
          message: 'A price in dollars, like 10 or 9.99'
        });
      }
      if (!form[`${name}PriceId`].trim()) {
        ctx.addIssue({
          code: 'custom',
          path: [`${name}PriceId`],
          message: 'Enter the price ID'
        });
      }
    }
  });

type PlanForm = z.infer<typeof planSchema>;

const emptyForm: PlanForm = {
  name: '',
  description: '',
  quotaId: '',
  tierId: NO_TIER,
  displayOrder: '0',
  billingType: 'month',
  processor: PAYMENT_PROCESSORS[0].id,
  monthlyPrice: '',
  monthlyPriceId: '',
  yearlyPrice: '',
  yearlyPriceId: ''
};

const BILLING_TYPE_OPTIONS = BILLING_TYPES.map(t => ({
  value: t.value,
  label: t.label
}));
const PROCESSOR_OPTIONS = PAYMENT_PROCESSORS.map(p => ({
  value: p.id,
  label: p.label
}));
const processorLabel = (id: string | null) =>
  PAYMENT_PROCESSORS.find(p => p.id === id)?.label ?? '—';
const PER = { month: 'month', year: 'year' } as const;
/** "Price ID" → "price ID": only the first letter, so an ID stays an ID. */
const lowerFirst = (text: string) =>
  text.charAt(0).toLowerCase() + text.slice(1);

const helper = createAppColumnHelper<Plan>();

const planColumns = (actions: {
  edit: (plan: Plan) => void;
  remove: (id: string) => void;
  setEnabled: (id: string, isEnabled: boolean) => void;
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
    helper.display({
      id: 'price',
      header: 'Price',
      cell: ({ row }) => {
        const plan = row.original;
        const prices = intervalsOf(plan.billingType).flatMap(interval => {
          const price =
            interval === 'month' ? plan.monthlyPrice : plan.yearlyPrice;
          return price == null ? [] : [{ interval, price }];
        });
        if (prices.length === 0) {
          return (
            <span className="text-sm text-muted-foreground">No price</span>
          );
        }
        return (
          <div className="text-sm">
            {prices.map(({ interval, price }) => (
              <div key={interval} className="font-medium">
                {formatPrice(price)}
                <span className="font-normal text-muted-foreground">
                  {' '}
                  / {PER[interval]}
                </span>
              </div>
            ))}
            <div className="text-xs text-muted-foreground">
              {processorLabel(plan.processor)}
            </div>
          </div>
        );
      }
    }),
    helper.accessor(row => row.tier?.name, {
      id: 'tier',
      header: 'Tier',
      cell: ({ row }) =>
        row.original.tier ? (
          <div className="text-sm">
            <div className="font-medium">{row.original.tier.name}</div>
            <div className="text-xs text-muted-foreground">
              {describeMultiplier(row.original.tier.priceMultiplier)}
            </div>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">No tier</span>
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
      id: 'enabled',
      header: 'Enabled',
      meta: { align: 'center' },
      // Open to new subscriptions. Off, it is not offered; those already on
      // it go on renewing.
      cell: ({ row }) => (
        <Switch
          checked={row.original.isEnabled}
          onCheckedChange={checked =>
            actions.setEnabled(row.original.id, checked)
          }
          aria-label={`Enable ${row.original.name}`}
        />
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
              {/* A plan anyone has subscribed to stays; the span keeps the
                  tooltip working over a disabled button. */}
              <span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={row.original.isLocked}
                  onClick={() => actions.remove(row.original.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {row.original.isLocked
                ? 'Has subscriptions, so it cannot be deleted. Disable it instead.'
                : 'Delete'}
            </TooltipContent>
          </Tooltip>
        </>
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
export function PlansPending() {
  return (
    <ConsoleTableSkeleton
      columns={planColumns({ edit: noop, remove: noop, setEnabled: noop })}
      search={false}
    />
  );
}

export default function PlansPage() {
  const [page, setPage] = useSearchFilter('page', 1);

  const queryClient = useQueryClient();
  const { data, isLoading, isPlaceholderData } = useQuery(
    planQueries.list(planTableInput({ page }))
  );
  const { data: quotaOptions } = useQuery(quotaQueries.listForSelect());
  const { data: tierOptions } = useQuery(tierQueries.listForSelect());
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: mutating(createPlan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planQueries.key.list() });
      toast.success('Plan created. Enable it to offer it to users.');
    }
  });

  const update = useMutation({
    mutationFn: mutating(updatePlan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planQueries.key.list() });
      toast.success('Plan saved');
    }
  });

  const toggle = useMutation({
    mutationFn: (data: { id: string; isEnabled: boolean }) =>
      setPlanEnabled({ data }),
    onSuccess: (_, { isEnabled }) => {
      queryClient.invalidateQueries({ queryKey: planQueries.key.list() });
      toast.success(isEnabled ? 'Plan enabled' : 'Plan disabled');
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

  const [defaults, setDefaults] = useState(emptyForm);

  const form = useAppForm({
    defaultValues: defaults,
    validators: { onChange: planSchema },
    onSubmit: async ({ value }) => {
      const payload = {
        name: value.name.trim(),
        description: value.description.trim() || null,
        quotaId: value.quotaId,
        tierId: value.tierId === NO_TIER ? null : value.tierId,
        displayOrder: Number(value.displayOrder) || 0,
        billingType: value.billingType,
        processor: value.processor,
        // The interval the billing type does not sell at is sent as none.
        ...Object.fromEntries(
          (['month', 'year'] as const).flatMap(interval => {
            const name = interval === 'month' ? 'monthly' : 'yearly';
            const sold = intervalsOf(value.billingType).includes(interval);
            return [
              [
                `${name}Price`,
                sold ? Number(value[`${name}Price`].trim()) : null
              ],
              [`${name}PriceId`, sold ? value[`${name}PriceId`].trim() : null]
            ];
          })
        )
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
  const openFor = (plan: EditablePlan | Plan | null) => {
    setEditingId(plan?.id ?? null);
    setLocked(plan?.isLocked ?? false);
    const values: PlanForm = plan
      ? {
          name: plan.name,
          description: plan.description ?? '',
          quotaId: plan.quotaId,
          tierId: plan.tierId ?? NO_TIER,
          displayOrder: plan.displayOrder.toString(),
          billingType: plan.billingType ?? 'month',
          processor: plan.processor ?? PAYMENT_PROCESSORS[0].id,
          monthlyPrice:
            plan.monthlyPrice != null
              ? Number(plan.monthlyPrice).toFixed(2)
              : '',
          monthlyPriceId: plan.monthlyPriceId ?? '',
          yearlyPrice:
            plan.yearlyPrice != null ? Number(plan.yearlyPrice).toFixed(2) : '',
          yearlyPriceId: plan.yearlyPriceId ?? ''
        }
      : emptyForm;
    // The IDs the plan already has are not new ones to offer syncing from.
    setSyncedIds({
      month: values.monthlyPriceId,
      year: values.yearlyPriceId
    });
    setDefaults(values);
    form.reset(values);
    setOpen(true);
  };

  // Subscribed to: the billing, prices, processor and price IDs are fixed.
  const [locked, setLocked] = useState(false);
  // Per interval, the price ID the price was last taken from, or the plan's
  // own; a different one is offered to sync from.
  const [syncedIds, setSyncedIds] = useState<Record<BillingInterval, string>>({
    month: '',
    year: ''
  });
  const billingType = useStore(form.store, state => state.values.billingType);
  const priceIds = useStore(form.store, state => ({
    month: state.values.monthlyPriceId.trim(),
    year: state.values.yearlyPriceId.trim()
  }));
  const processor = useStore(form.store, state => state.values.processor);
  // What the chosen processor calls the ID a plan is sold by.
  const processorInfo = PAYMENT_PROCESSORS.find(p => p.id === processor);
  const sync = useMutation({
    mutationFn: (data: {
      processor: PaymentProcessorId;
      priceId: string;
      interval: BillingInterval;
    }) => lookupPlanPrice({ data }),
    onSuccess: (found, { priceId, interval }) => {
      // Only a price billed at the interval it is entered for.
      if (found.interval !== interval) {
        toast.error(
          `This price is billed ${found.interval === 'year' ? 'yearly' : 'monthly'}, not ${interval === 'year' ? 'yearly' : 'monthly'}.`
        );
        return;
      }
      form.setFieldValue(
        interval === 'month' ? 'monthlyPrice' : 'yearlyPrice',
        found.price.toFixed(2)
      );
      setSyncedIds(ids => ({ ...ids, [interval]: priceId }));
      toast.success('Price synced');
    },
    onError: e => toast.error(e.message)
  });

  // Editing opens the form on the row as the table shows it, held, and fills
  // it again from the plan as read now — then it can be typed in.
  const record = useEditRecord(
    id => getPlan({ data: { id } }),
    'plan',
    () => setOpen(false)
  );
  // Every way out of the dialog: a read still out for it is no longer wanted.
  const close = () => {
    record.cancel();
    setOpen(false);
  };
  const openEdit = async (shown: Plan) => {
    openFor(shown);
    const plan = await record.load(shown.id);
    if (plan) openFor(plan);
  };

  const columns = useMemo(
    () =>
      planColumns({
        edit: openEdit,
        remove: setDeleteId,
        setEnabled: (id, isEnabled) => toggle.mutate({ id, isEnabled })
      }),
    []
  );

  const quotaSelectOptions = useMemo(
    () => (quotaOptions ?? []).map(q => ({ value: q.id, label: q.name })),
    [quotaOptions]
  );
  // No tier is a choice too — the cost price, every model — and is offered
  // as one.
  const tierSelectOptions = useMemo(
    () => [
      { value: NO_TIER, label: 'No tier' },
      ...(tierOptions ?? []).map(t => ({
        value: t.id,
        label: `${t.name} ${describeMultiplier(t.priceMultiplier)}`,
        node: <TierLabel name={t.name} priceMultiplier={t.priceMultiplier} />
      }))
    ],
    [tierOptions]
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
                What users subscribe to: its quota and tier, and its price.
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
                      rows={4}
                      placeholder={
                        '5x more usage than Go\nEvery model\nPriority support'
                      }
                      hint="Shown on the plan's card when users choose a plan. Each line is one point."
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
                {/* A select has no empty value, so "no tier" is a value of
                    its own, mapped back to none on the way out. */}
                <form.AppField name="tierId">
                  {field => (
                    <field.SelectField
                      label="Tier"
                      options={tierSelectOptions}
                      hint="The price multiplier and models for this plan's users. A user's own tier takes its place."
                    />
                  )}
                </form.AppField>
                <div className="space-y-4 border-t pt-4">
                  <div className="text-sm font-medium">Price</div>
                  <div className="grid grid-cols-2 gap-4">
                    <form.AppField name="billingType">
                      {field => (
                        <field.SelectField
                          label="Billing"
                          options={BILLING_TYPE_OPTIONS}
                          disabled={locked}
                        />
                      )}
                    </form.AppField>
                    <form.AppField name="processor">
                      {field => (
                        <field.SelectField
                          label="Payment processor"
                          options={PROCESSOR_OPTIONS}
                          disabled={locked}
                        />
                      )}
                    </form.AppField>
                  </div>
                  {intervalsOf(billingType).map(interval => {
                    const monthly = interval === 'month';
                    const priceId = priceIds[interval];
                    return (
                      <div key={interval} className="space-y-2">
                        <div className="grid grid-cols-2 gap-4">
                          <form.AppField
                            name={monthly ? 'monthlyPrice' : 'yearlyPrice'}
                          >
                            {field => (
                              <field.TextField
                                label={`${monthly ? 'Monthly' : 'Yearly'} price (USD)`}
                                prefix="$"
                                inputMode="decimal"
                                placeholder={monthly ? '10.00' : '100.00'}
                                disabled={locked}
                              />
                            )}
                          </form.AppField>
                          <form.AppField
                            name={monthly ? 'monthlyPriceId' : 'yearlyPriceId'}
                          >
                            {field => (
                              <field.TextField
                                label={`${monthly ? 'Monthly' : 'Yearly'} ${lowerFirst(processorInfo?.priceIdLabel ?? 'Price ID')}`}
                                placeholder={processorInfo?.priceIdPlaceholder}
                                disabled={locked}
                              />
                            )}
                          </form.AppField>
                        </div>
                        {/* A new ID can bring its amount with it — offered,
                            never done behind the admin's back. */}
                        {!locked &&
                          priceId &&
                          priceId !== syncedIds[interval] && (
                            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
                              <span>
                                Sync the {monthly ? 'monthly' : 'yearly'} price
                                from {processorLabel(processor)}?
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                disabled={sync.isPending}
                                onClick={() =>
                                  sync.mutate({ processor, priceId, interval })
                                }
                              >
                                {sync.isPending &&
                                sync.variables?.interval === interval ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="size-4" />
                                )}
                                Sync price
                              </Button>
                            </div>
                          )}
                      </div>
                    );
                  })}
                  {locked && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Lock className="size-3.5 shrink-0" />
                      This plan has subscriptions, so its billing, prices,
                      payment processor and price IDs are fixed.
                    </p>
                  )}
                </div>
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
        empty="No plans yet. Create a Quota first, then add a plan."
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
            <AlertDialogTitle>Delete Plan</AlertDialogTitle>
            <AlertDialogDescription>
              No one has subscribed to this plan. It will be deleted.
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
