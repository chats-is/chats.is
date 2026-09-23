import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';

import { CAPABILITIES } from '@/lib/constant';
import { mutating } from '@/lib/mutation';
import { summarizePricingRows } from '@/lib/pricing-summary';
import { cn, formatUsd } from '@/lib/utils';
import { useEditRecord } from '@/hooks/use-edit-record';
import { useSearchFilter } from '@/hooks/use-search-filter';
import { modelQueries } from '@/server/functions/model';
import {
  deletePricing,
  getModelPricing,
  previewPricingSync,
  pricingQueries,
  runPricingSync,
  upsertPricing,
  type listPricingWithModels
} from '@/server/functions/pricing';
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
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useAppForm } from '@/components/app-form';
import {
  createAppColumnHelper,
  DataTable
} from '@/components/console/data-table';
import { modelIdentityColumns } from '@/components/console/model-identity-columns';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { pricingTableInput } from '@/components/console/table-filters';
import {
  ConsoleFilters,
  ConsoleSearch,
  ConsoleToolbar
} from '@/components/console/toolbar';
import { UnpricedBadge } from '@/components/console/unpriced-badge';

type PricingSource = 'models.dev' | 'llm-metadata';
const ALL_SOURCES: PricingSource[] = ['models.dev', 'llm-metadata'];

type RemoteCost = {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
};

type LocalCost = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

/**
 * One line of the preview: a model as one of its providers lists it.
 *
 * A model paired with two providers appears twice, because the catalogue can
 * carry a different rate under each — so `key` identifies the line and
 * `modelDbId` the model it would write to. Only one line per model can be
 * taken, since a model has one pricing row.
 */
type PreviewRow = {
  key: string;
  modelDbId: string;
  modelId: string;
  modelName: string;
  providerType: string | null;
  providerName: string | null;
  current: LocalCost | null;
  sources: Record<
    PricingSource,
    { matched: boolean; remote: RemoteCost | null }
  >;
};

/** Which model the pricing dialog is pointed at. Its rates live in the form. */
type EditTarget = {
  modelDbId: string;
  modelName: string;
  capability: 'chat' | 'image' | 'video' | 'audio';
};

/** Every rate a model can carry, as typed. Blank means "not priced". */
type PricingForm = {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  reasoning: string;
  image: string;
  video: string;
  videoSeconds: string;
  audioInput: string;
  audioOutput: string;
  audioCharacters: string;
  audioSeconds: string;
};

type PriceName = keyof PricingForm;

const EMPTY_PRICING: PricingForm = {
  input: '',
  output: '',
  cacheRead: '',
  cacheWrite: '',
  reasoning: '',
  image: '',
  video: '',
  videoSeconds: '',
  audioInput: '',
  audioOutput: '',
  audioCharacters: '',
  audioSeconds: ''
};

const fromNum = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? '' : String(v);

const numOrDash = (v: number | null | undefined) =>
  v === undefined || v === null ? '—' : formatUsd(v);

/** What the edit form is filled from: the row as read when it opens. */
type EditableRow = NonNullable<Awaited<ReturnType<typeof getModelPricing>>>;
type PricingRow = Awaited<
  ReturnType<typeof listPricingWithModels>
>['rows'][number];

const helper = createAppColumnHelper<PricingRow>();

const pricingColumns = (actions: {
  edit: (row: PricingRow) => void;
  remove: (row: PricingRow) => void;
}) =>
  helper.columns([
    ...modelIdentityColumns(helper),
    helper.display({
      id: 'pricing',
      header: 'Pricing',
      meta: {
        headClassName: 'w-92',
        cellClassName: 'font-mono text-[11px] text-muted-foreground'
      },
      cell: ({ row }) => {
        const rows = summarizePricingRows(
          row.original.capability,
          row.original.pricing
        );
        if (rows.length === 0) return <UnpricedBadge />;
        return (
          <div className="space-y-0.5">
            {rows.map(group => (
              <div key={group[0]} className="flex gap-x-2 whitespace-nowrap">
                {group.map(line => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            ))}
          </div>
        );
      }
    }),
    helper.accessor(row => row.pricing?.source, {
      id: 'source',
      header: 'Source',
      meta: {
        align: 'right',
        cellClassName: 'text-xs whitespace-nowrap text-muted-foreground'
      },
      cell: ({ row }) => row.original.pricing?.source ?? '—'
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.edit(row.original)}
          >
            <Pencil className="size-4" />
          </Button>
          {/* Only a price that exists can be taken away; the space is kept
              either way so the edit buttons stay in one column. */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(!row.original.pricing && 'invisible')}
            onClick={() => actions.remove(row.original)}
          >
            <Trash2 className="size-4" />
          </Button>
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
export function PricingPending() {
  return (
    <ConsoleTableSkeleton
      columns={pricingColumns({ edit: noop, remove: noop })}
      filters={1}
    />
  );
}

export default function PricingPage() {
  const queryClient = useQueryClient();
  const [filterCapability, setFilterCapability] = useSearchFilter(
    'capability',
    'all'
  );
  const [search, setSearch] = useSearchFilter('q', '');
  const [edit, setEdit] = useState<EditTarget | null>(null);

  // Source selection — held in the popover before opening preview.
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedSources, setSelectedSources] = useState<PricingSource[]>([
    'models.dev',
    'llm-metadata'
  ]);

  const [page, setPage] = useSearchFilter('page', 1);

  const { data, isLoading, isPlaceholderData } = useQuery(
    pricingQueries.listWithModels(
      pricingTableInput({ capability: filterCapability, q: search, page })
    )
  );

  // A price is read by the models table too, which says whether each model
  // has one.
  const invalidatePrices = () => {
    queryClient.invalidateQueries({
      queryKey: pricingQueries.key.listWithModels()
    });
    queryClient.invalidateQueries({ queryKey: modelQueries.key.list() });
  };

  const upsertMutation = useMutation({
    mutationFn: mutating(upsertPricing),
    onSuccess: () => {
      invalidatePrices();
      setEdit(null);
      toast.success('Pricing saved');
    },
    onError: e => toast.error(e.message)
  });

  const [removing, setRemoving] = useState<PricingRow | null>(null);
  const deleteMutation = useMutation({
    mutationFn: mutating(deletePricing),
    onSuccess: () => {
      invalidatePrices();
      setRemoving(null);
      toast.success('Pricing deleted');
    },
    onError: e => toast.error(e.message)
  });

  // Two mutation instances so we can fire them in parallel without state
  // collision on a single hook.
  const previewMd = useMutation({
    mutationFn: mutating(previewPricingSync)
  });
  const previewLm = useMutation({
    mutationFn: mutating(previewPricingSync)
  });
  const previewLoading = previewMd.isPending || previewLm.isPending;

  const syncMutation = useMutation({
    mutationFn: mutating(runPricingSync),
    onError: e => toast.error(e.message)
  });

  // Preview state (after Compare is clicked).
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSources, setPreviewSources] = useState<PricingSource[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewSearch, setPreviewSearch] = useState('');
  // A pick is per preview line, not per model: `key` → the catalogue taken.
  /** Which line of the preview to take, by its key. */
  const [picks, setPicks] = useState<Map<string, PricingSource>>(new Map());

  const [defaults, setDefaults] = useState(EMPTY_PRICING);

  const form = useAppForm({
    defaultValues: defaults,
    onSubmit: async ({ value }) => {
      if (!edit) return;
      // A blank field is not a zero rate — it means the model is not priced
      // that way at all, so it is stored as null.
      const rates = Object.fromEntries(
        (Object.keys(value) as Array<PriceName>).map(name => [
          name,
          value[name] || null
        ])
      ) as Record<PriceName, string | null>;

      await upsertMutation.mutateAsync({
        modelDbId: edit.modelDbId,
        ...rates,
        source: 'manual'
      });
    }
  });

  /** Fill the form from a model and its price. */
  const fill = (row: EditableRow) => {
    setEdit({
      modelDbId: row.id,
      modelName: row.name,
      capability: row.capability
    });
    const values = {
      input: fromNum(row.pricing?.input),
      output: fromNum(row.pricing?.output),
      cacheRead: fromNum(row.pricing?.cacheRead),
      cacheWrite: fromNum(row.pricing?.cacheWrite),
      reasoning: fromNum(row.pricing?.reasoning),
      image: fromNum(row.pricing?.image),
      video: fromNum(row.pricing?.video),
      videoSeconds: fromNum(row.pricing?.videoSeconds),
      audioInput: fromNum(row.pricing?.audioInput),
      audioOutput: fromNum(row.pricing?.audioOutput),
      audioCharacters: fromNum(row.pricing?.audioCharacters),
      audioSeconds: fromNum(row.pricing?.audioSeconds)
    };
    setDefaults(values);
    form.reset(values);
  };

  // Editing opens the form on the row as the table shows it, held, and fills
  // it again from the model and its price as read now — then it can be typed
  // in.
  const record = useEditRecord(
    id => getModelPricing({ data: { id } }),
    'model',
    () => setEdit(null)
  );
  // Every way out of the dialog: a read still out for it is no longer wanted.
  const close = () => {
    record.cancel();
    setEdit(null);
  };
  const openEdit = async (shown: PricingRow) => {
    fill(shown);
    const fresh = await record.load(shown.id);
    if (fresh) fill(fresh);
  };

  const columns = useMemo(
    () => pricingColumns({ edit: openEdit, remove: setRemoving }),
    []
  );

  /**
   * One rate. Several rates are mutually exclusive billing styles — typing in
   * one clears the others, which `clears` names.
   */
  const PriceField = ({
    name,
    label,
    placeholder = '0.00',
    disabled,
    clears
  }: {
    name: PriceName;
    label: string;
    placeholder?: string;
    disabled?: boolean;
    clears?: Array<PriceName>;
  }) => (
    <form.AppField
      name={name}
      listeners={{
        // Guarded: clearing counts as a change, so two fields that clear each
        // other would take turns doing it forever. Skipping the write when
        // there is nothing to clear ends the exchange after one step — and
        // stops the recursion from wiping what was just typed.
        onChange: () =>
          clears?.forEach(other => {
            if (form.getFieldValue(other)) form.setFieldValue(other, '');
          })
      }}
    >
      {field => (
        <field.TextField
          label={label}
          prefix="$"
          inputMode="decimal"
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </form.AppField>
  );

  const toggleSource = (src: PricingSource, on: boolean) => {
    setSelectedSources(prev => {
      if (on) return Array.from(new Set([...prev, src]));
      return prev.filter(s => s !== src);
    });
  };

  const compare = async () => {
    if (selectedSources.length === 0) return;
    const sources = [...selectedSources];
    setPopoverOpen(false);
    try {
      const results = await Promise.all(
        sources.map(src => {
          const m = src === 'models.dev' ? previewMd : previewLm;
          return m
            .mutateAsync({ source: src })
            .then(rows => ({ source: src, rows }));
        })
      );
      // Merge by model *and* provider: the two catalogues return the same
      // lines, and a model with two providers has two of them.
      const merged = new Map<string, PreviewRow>();
      for (const { source, rows } of results) {
        for (const r of rows) {
          const key = `${r.modelDbId}:${r.providerType ?? ''}`;
          const entry = merged.get(key) ?? {
            key,
            modelDbId: r.modelDbId,
            modelId: r.modelId,
            modelName: r.modelName,
            providerType: r.providerType,
            providerName: r.providerName,
            current: r.current,
            sources: {
              'models.dev': { matched: false, remote: null },
              'llm-metadata': { matched: false, remote: null }
            }
          };
          entry.sources[source] = { matched: r.matched, remote: r.remote };
          // Keep latest current (they should be the same).
          entry.current = r.current;
          merged.set(key, entry);
        }
      }
      setPreviewSources(sources);
      setPreviewRows(Array.from(merged.values()));
      setPicks(new Map());
      setPreviewSearch('');
      setPreviewOpen(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load remote prices'
      );
    }
  };

  // For 1-source mode, a row is "picked" when picks has it set to the lone source.
  // For 2-source mode, a row is "picked" when picks has it set to either source.
  const pickCount = picks.size;
  const applyDisabled = syncMutation.isPending || pickCount === 0;

  const apply = async () => {
    if (pickCount === 0) return;
    const groups: Record<
      PricingSource,
      Array<{ modelDbId: string; providerType: string }>
    > = {
      'models.dev': [],
      'llm-metadata': []
    };
    for (const [key, src] of picks.entries()) {
      const row = previewRows.find(r => r.key === key);
      if (!row?.providerType) continue;
      groups[src].push({
        modelDbId: row.modelDbId,
        providerType: row.providerType
      });
    }
    try {
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      const skipped: string[] = [];
      for (const source of previewSources) {
        const from = groups[source];
        if (from.length === 0) continue;
        const result = await syncMutation.mutateAsync({
          source,
          modelDbIds: from.map(pick => pick.modelDbId),
          from
        });
        created += result.created;
        updated += result.updated;
        unchanged += result.unchanged;
        skipped.push(...result.skipped.map(entry => entry.modelId));
      }
      invalidatePrices();
      setPreviewOpen(false);
      toast.success(
        `Applied: ${created} new, ${updated} updated${unchanged ? `, ${unchanged} unchanged` : ''}`
      );
      if (skipped.length > 0) {
        toast.warning(
          `Left as they were, because the source's prices would have stopped them working: ${skipped.join(', ')}`
        );
      }
    } catch {
      // Toast already shown in onError.
    }
  };

  return (
    <div className="space-y-6">
      <ConsoleToolbar>
        <ConsoleFilters>
          <ConsoleSearch
            placeholder="Search models..."
            value={search}
            onChange={setSearch}
          />
          <Select value={filterCapability} onValueChange={setFilterCapability}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Capabilities</SelectItem>
              {CAPABILITIES.map(cap => (
                <SelectItem key={cap.value} value={cap.value}>
                  {cap.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ConsoleFilters>

        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              className="gap-2"
              disabled={previewLoading || syncMutation.isPending}
            >
              {previewLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Sync prices
              <ChevronDown className="size-3 opacity-70" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <div className="space-y-3">
              <Label className="text-sm">Choose sources to sync</Label>
              <div className="space-y-2">
                {ALL_SOURCES.map(src => (
                  <label
                    key={src}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedSources.includes(src)}
                      onCheckedChange={c => toggleSource(src, c === true)}
                    />
                    <span className="font-mono text-sm">{src}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 border-t pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPopoverOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={selectedSources.length === 0}
                  onClick={compare}
                >
                  Preview
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </ConsoleToolbar>

      <DataTable
        columns={columns}
        data={isLoading ? undefined : data?.rows}
        empty="No models found."
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

      <Dialog open={!!edit} onOpenChange={open => !open && close()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Pricing — {edit?.modelName}</DialogTitle>
            <DialogDescription>
              Pricing used to compute cost when this model is used.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form
              onSubmit={e => {
                e.preventDefault();
                form.handleSubmit();
              }}
            >
              <form.Subscribe selector={state => state.values}>
                {values => (
                  <fieldset
                    disabled={record.isLoading}
                    className="-mx-6 grid max-h-[60vh] min-w-0 grid-cols-2 gap-4 overflow-y-auto px-6"
                  >
                    {edit.capability === 'chat' && (
                      <>
                        <PriceField name="input" label="Input / 1M tokens" />
                        <PriceField name="output" label="Output / 1M tokens" />
                        <PriceField
                          name="cacheRead"
                          label="Cache read / 1M tokens"
                        />
                        <PriceField
                          name="cacheWrite"
                          label="Cache write / 1M tokens"
                        />
                        <PriceField
                          name="reasoning"
                          label="Reasoning / 1M tokens"
                          placeholder="defaults to output rate"
                        />
                      </>
                    )}
                    {edit.capability === 'image' && (
                      <>
                        {/* Two mutually-exclusive billing styles. Typing in one
                            side disables (and clears) the other. */}
                        <PriceField
                          name="image"
                          label="Per image"
                          placeholder="per-image (DALL-E, imagen)"
                          disabled={!!values.input || !!values.output}
                          clears={['input', 'output']}
                        />
                        <div className="col-span-2 text-xs text-muted-foreground">
                          Or token-based billing (gpt-image-1) — set Input +
                          Output instead of Per image:
                        </div>
                        <PriceField
                          name="input"
                          label="Input / 1M tokens"
                          disabled={!!values.image}
                          clears={['image']}
                        />
                        <PriceField
                          name="output"
                          label="Output / 1M tokens"
                          disabled={!!values.image}
                          clears={['image']}
                        />
                      </>
                    )}
                    {edit.capability === 'video' && (
                      <>
                        {/* Two mutually-exclusive billing styles. Typing in one
                            side disables (and clears) the other. */}
                        <PriceField
                          name="video"
                          label="Per video"
                          placeholder="flat per clip (Kling, Sora base)"
                          disabled={!!values.videoSeconds}
                          clears={['videoSeconds']}
                        />
                        <PriceField
                          name="videoSeconds"
                          label="Video / second"
                          placeholder="per second (Sora, Veo, Runway)"
                          disabled={!!values.video}
                          clears={['video']}
                        />
                      </>
                    )}
                    {edit.capability === 'audio' && (
                      <>
                        {/* Three mutually-exclusive billing styles. Typing in
                            one style disables (and clears) the others. */}
                        <PriceField
                          name="audioCharacters"
                          label="Per 1M characters"
                          placeholder="classic TTS (tts-1, ElevenLabs)"
                          disabled={
                            !!values.audioInput ||
                            !!values.audioOutput ||
                            !!values.audioSeconds
                          }
                          clears={['audioInput', 'audioOutput', 'audioSeconds']}
                        />
                        <div className="col-span-2 text-xs text-muted-foreground">
                          Or token-based billing (gpt-4o-mini-tts) — set Audio
                          input + output instead of Per 1M characters:
                        </div>
                        <PriceField
                          name="audioInput"
                          label="Audio input / 1M tokens"
                          disabled={
                            !!values.audioCharacters || !!values.audioSeconds
                          }
                          clears={['audioCharacters', 'audioSeconds']}
                        />
                        <PriceField
                          name="audioOutput"
                          label="Audio output / 1M tokens"
                          disabled={
                            !!values.audioCharacters || !!values.audioSeconds
                          }
                          clears={['audioCharacters', 'audioSeconds']}
                        />
                        <div className="col-span-2 text-xs text-muted-foreground">
                          Or per-second billing for STT models (whisper-1) — set
                          Audio / second instead:
                        </div>
                        <PriceField
                          name="audioSeconds"
                          label="Audio / second"
                          placeholder="per second of input audio (whisper-1: 0.0001)"
                          disabled={
                            !!values.audioCharacters ||
                            !!values.audioInput ||
                            !!values.audioOutput
                          }
                          clears={[
                            'audioCharacters',
                            'audioInput',
                            'audioOutput'
                          ]}
                        />
                      </>
                    )}
                  </fieldset>
                )}
              </form.Subscribe>
              <DialogFooter className="mt-4">
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
                    Save
                  </form.SubmitButton>
                </form.AppForm>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        sources={previewSources}
        rows={previewRows}
        search={previewSearch}
        setSearch={setPreviewSearch}
        picks={picks}
        setPicks={setPicks}
        applyDisabled={applyDisabled}
        applyPending={syncMutation.isPending}
        onApply={apply}
      />

      <AlertDialog
        open={!!removing}
        onOpenChange={open => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Pricing</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the price of {removing?.name}? Its usage will be recorded
              at no cost until it is priced again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing?.pricing) {
                  deleteMutation.mutate({ id: removing.pricing.id });
                }
              }}
              disabled={deleteMutation.isPending}
              variant="destructive"
              className="gap-2"
            >
              {deleteMutation.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PreviewDialog({
  open,
  onOpenChange,
  sources,
  rows,
  search,
  setSearch,
  picks,
  setPicks,
  applyDisabled,
  applyPending,
  onApply
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: PricingSource[];
  rows: PreviewRow[];
  search: string;
  setSearch: (v: string) => void;
  picks: Map<string, PricingSource>;
  setPicks: React.Dispatch<React.SetStateAction<Map<string, PricingSource>>>;
  applyDisabled: boolean;
  applyPending: boolean;
  onApply: () => void;
}) {
  const q = search.toLowerCase().trim();
  const visibleRows = q
    ? rows.filter(
        r =>
          r.modelName.toLowerCase().includes(q) ||
          r.modelId.toLowerCase().includes(q)
      )
    : rows;

  const isSingle = sources.length === 1;

  /**
   * Take one line, or none.
   *
   * A model has a single pricing row, so taking a line drops any other line of
   * the same model — picking Azure's rate after OpenAI's replaces it rather
   * than queueing both writes against the same row.
   */
  const togglePick = (row: PreviewRow, source: PricingSource | null) => {
    setPicks(prev => {
      const next = new Map(prev);
      for (const other of rows) {
        if (other.modelDbId === row.modelDbId) next.delete(other.key);
      }
      if (source !== null) next.set(row.key, source);
      return next;
    });
  };

  // For each source, are all matched visible rows currently picked from THAT source?
  const matchedVisibleBySource: Record<PricingSource, PreviewRow[]> = {
    'models.dev': [],
    'llm-metadata': []
  };
  for (const r of visibleRows) {
    for (const src of sources) {
      if (r.sources[src].matched) matchedVisibleBySource[src].push(r);
    }
  }
  /** Ticked when every model with a match here has one of its lines taken —
   *  per model, not per line, since only one line of a model can be. */
  const allMatchedFor = (src: PricingSource) => {
    const list = matchedVisibleBySource[src];
    if (list.length === 0) return false;
    const models = new Set(list.map(r => r.modelDbId));
    const taken = new Set(
      list.filter(r => picks.get(r.key) === src).map(r => r.modelDbId)
    );
    return models.size === taken.size;
  };
  const togglePickAllFor = (src: PricingSource, on: boolean) => {
    const matched = matchedVisibleBySource[src];
    setPicks(prev => {
      const next = new Map(prev);
      // A model can only take one line, so where it has several here the
      // first one wins and the rest are left alone.
      const spokenFor = new Set(
        [...next.keys()]
          .map(key => rows.find(row => row.key === key)?.modelDbId)
          .filter(Boolean)
      );
      for (const row of matched) {
        if (on) {
          if (spokenFor.has(row.modelDbId)) continue;
          next.set(row.key, src);
          spokenFor.add(row.modelDbId);
        } else if (next.get(row.key) === src) {
          next.delete(row.key);
          spokenFor.delete(row.modelDbId);
        }
      }
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={isSingle ? 'sm:max-w-5xl' : 'sm:max-w-6xl'}>
        <DialogHeader>
          <DialogTitle>Sync preview</DialogTitle>
          <DialogDescription>
            Check the source you want to use for each row. Picking one unchecks
            the other. Leave both unchecked to skip the row.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by model name or id..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="overflow-hidden rounded-md border">
          {/* Header table — never scrolls */}
          <table className="w-full table-fixed">
            <PreviewColgroup sources={sources} />
            <thead>
              <tr className="border-b bg-muted/50">
                <th rowSpan={2} className="p-3 text-left text-sm font-medium">
                  Model
                </th>
                <th
                  colSpan={2}
                  className="border-l p-3 text-center text-sm font-medium"
                >
                  Current
                </th>
                {sources.map(src => (
                  <th
                    key={src}
                    colSpan={4}
                    className="border-l p-3 text-center text-sm font-medium"
                  >
                    {src}
                  </th>
                ))}
              </tr>
              <tr className="border-b bg-muted/50">
                {/* Current sub-headers: I/O pair + Cache R/W pair */}
                <th className="border-l px-2 py-2 text-right text-xs font-normal text-muted-foreground">
                  <div className="flex flex-col items-end gap-0.5">
                    <span>Input</span>
                    <span>Output</span>
                  </div>
                </th>
                <th className="px-2 py-2 text-right text-xs font-normal text-muted-foreground">
                  <div className="flex flex-col items-end gap-0.5">
                    <span>Cache R</span>
                    <span>Cache W</span>
                  </div>
                </th>
                {/* Per-source sub-headers */}
                {sources.flatMap(src => [
                  <th key={`${src}-cb`} className="border-l p-3">
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={allMatchedFor(src)}
                        disabled={matchedVisibleBySource[src].length === 0}
                        onCheckedChange={c => togglePickAllFor(src, c === true)}
                      />
                    </div>
                  </th>,
                  <th
                    key={`${src}-l1`}
                    className="px-2 py-2 text-right text-xs font-normal text-muted-foreground"
                  >
                    <div className="flex flex-col items-end gap-0.5">
                      <span>Input</span>
                      <span>Output</span>
                    </div>
                  </th>,
                  <th
                    key={`${src}-l2`}
                    className="px-2 py-2 text-right text-xs font-normal text-muted-foreground"
                  >
                    <div className="flex flex-col items-end gap-0.5">
                      <span>Cache R</span>
                      <span>Cache W</span>
                    </div>
                  </th>,
                  <th
                    key={`${src}-st`}
                    className="px-2 py-3 text-right text-xs font-normal text-muted-foreground"
                  >
                    Status
                  </th>
                ])}
              </tr>
            </thead>
          </table>

          {/* Body table — scrolls. Hide the scrollbar entirely so the body
              table fills 100% width and lines up with the header columns.
              Scrolling still works via wheel / touch / keyboard. */}
          <div className="max-h-[55vh] [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden">
            <table className="w-full table-fixed">
              <PreviewColgroup sources={sources} />
              <tbody>
                {visibleRows.map(r => {
                  const pick = picks.get(r.key);
                  return (
                    <tr
                      key={r.key}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="p-2 align-middle">
                        <div className="font-mono text-sm">{r.modelId}</div>
                        {/* Which provider's listing this line came from — the
                            only thing telling two lines of one model apart. */}
                        <div className="text-xs text-muted-foreground">
                          {r.providerName ?? 'No provider'}
                        </div>
                      </td>
                      <td className="border-l px-2 py-2 align-middle">
                        <StackedPrice
                          top={r.current?.input}
                          bottom={r.current?.output}
                        />
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <StackedPrice
                          top={r.current?.cacheRead}
                          bottom={r.current?.cacheWrite}
                        />
                      </td>
                      {sources.flatMap(src => {
                        const s = r.sources[src];
                        const status = classify(r, src);
                        const isPicked = pick === src;
                        return [
                          <td
                            key={`${src}-cb`}
                            className="border-l p-2 align-middle"
                          >
                            <div className="flex items-center justify-center">
                              <Checkbox
                                checked={isPicked}
                                disabled={!s.matched}
                                onCheckedChange={c => {
                                  if (c) togglePick(r, src);
                                  else if (isPicked) togglePick(r, null);
                                }}
                              />
                            </div>
                          </td>,
                          <td
                            key={`${src}-c1`}
                            className="px-2 py-2 align-middle"
                          >
                            <StackedPrice
                              top={s.remote?.input}
                              bottom={s.remote?.output}
                            />
                          </td>,
                          <td
                            key={`${src}-c2`}
                            className="px-2 py-2 align-middle"
                          >
                            <StackedPrice
                              top={s.remote?.cache_read}
                              bottom={s.remote?.cache_write}
                            />
                          </td>,
                          <td
                            key={`${src}-st`}
                            className="px-2 py-2 text-right align-middle text-xs"
                          >
                            <StatusBadge kind={status} />
                          </td>
                        ];
                      })}
                    </tr>
                  );
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={1 + 2 + sources.length * 4}
                      className="p-6 text-center text-muted-foreground"
                    >
                      {rows.length === 0
                        ? 'Nothing to preview.'
                        : 'No models match your search.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applyPending}
          >
            Cancel
          </Button>
          <Button onClick={onApply} disabled={applyDisabled} className="gap-2">
            {applyPending && <Loader2 className="size-4 animate-spin" />}
            Apply {picks.size}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function classify(
  row: PreviewRow,
  source: PricingSource
): 'new' | 'diff' | 'same' | 'missing' {
  const s = row.sources[source];
  if (!s.matched || !s.remote) return 'missing';
  if (!row.current) return 'new';
  const c = row.current;
  const same =
    s.remote.input === c.input &&
    s.remote.output === c.output &&
    s.remote.cache_read === c.cacheRead &&
    s.remote.cache_write === c.cacheWrite;
  return same ? 'same' : 'diff';
}

/** A stacked cell: two related values vertically inside the same table cell.
 *  Both lines share equal visual weight — column 1 holds Input/Output,
 *  column 2 holds Cache R/Cache W. */
function StackedPrice({
  top,
  bottom
}: {
  top?: number | null;
  bottom?: number | null;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5 font-mono text-xs">
      <span>{numOrDash(top)}</span>
      <span>{numOrDash(bottom)}</span>
    </div>
  );
}

function PreviewColgroup({ sources }: { sources: PricingSource[] }) {
  // Model — flexible (takes remainder).
  // Current: 2 sub-cols (in/cR stacked, out/cW stacked).
  // Per source: checkbox / 2 sub-cols / status.
  return (
    <colgroup>
      <col />
      <col style={{ width: '92px' }} />
      <col style={{ width: '92px' }} />
      {sources.map(src => (
        <Fragment key={src}>
          <col style={{ width: '40px' }} />
          <col style={{ width: '92px' }} />
          <col style={{ width: '92px' }} />
          <col style={{ width: '80px' }} />
        </Fragment>
      ))}
    </colgroup>
  );
}

const STATUS_STYLES = {
  same: {
    label: 'Same',
    title: 'No change between remote and local — safest',
    className:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
  },
  new: {
    label: 'New',
    title: 'New price (no local pricing yet)',
    className:
      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  },
  diff: {
    label: 'Diff',
    title: 'Remote price differs — sync will overwrite your local value',
    className:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  },
  missing: {
    label: 'Missing',
    title: 'Not found in this remote source — cannot be synced',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  }
} as const;

function StatusBadge({ kind }: { kind: keyof typeof STATUS_STYLES }) {
  const s = STATUS_STYLES[kind];
  return (
    <span
      title={s.title}
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}
