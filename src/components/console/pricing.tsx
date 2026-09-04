import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, Pencil, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';

import { CAPABILITIES } from '@/lib/constant';
import { mutating } from '@/lib/mutation';
import { onSelect } from '@/lib/select';
import { formatUsd } from '@/lib/utils';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  previewPricingSync,
  pricingQueries,
  runPricingSync,
  upsertPricing,
  type listPricingWithModels
} from '@/server/fn/pricing';
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
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { ModelIcon } from '@/components/model-icon';

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

type PreviewRow = {
  modelDbId: string;
  modelId: string;
  modelName: string;
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

/** Like `formatUsd` but returns `null` for unset values so callers can skip
 *  empty pricing lines (used by `summarizePricing`). */
const fmt = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)))
    return null;
  return formatUsd(v);
};

/**
 * Capability-aware list of pricing lines for the table. Each entry is
 * `"Label: $X"`; missing prices are omitted (no padding). Caller renders
 * the array one per line in the cell.
 *
 *   chat   → ["Input: $2.5", "Output: $15", "Cache Read: $0.25", "Cache Write: $0"]
 *   image  → ["Image: $0.04"]
 *   video  → ["Video: $0.5", "Per sec: $0.001"]
 *   audio  → ["Per 1M chars: $15"] or ["Input: $0.6", "Output: $12"]
 *
 * Token rates are per 1M tokens; image/video/per-sec are per unit.
 */
const capabilityFilterLabels = {
  all: 'All Capabilities',
  ...Object.fromEntries(CAPABILITIES.map(c => [c.value, c.label]))
};

function summarizePricing(
  capability: string,
  pricing:
    | {
        input?: string | null;
        output?: string | null;
        cacheRead?: string | null;
        cacheWrite?: string | null;
        reasoning?: string | null;
        image?: string | null;
        video?: string | null;
        videoSeconds?: string | null;
        audioInput?: string | null;
        audioOutput?: string | null;
        audioCharacters?: string | null;
        audioSeconds?: string | null;
      }
    | null
    | undefined
): string[] {
  if (!pricing) return [];
  const lines: string[] = [];
  // `unit` is the pricing basis suffix (e.g. /1M, /image) appended after the
  // dollar amount so each line reads like "Input: $10/1M".
  const push = (label: string, v: string | null | undefined, unit: string) => {
    const f = fmt(v);
    if (f) lines.push(`${label}: ${f}${unit}`);
  };
  switch (capability) {
    case 'chat': {
      push('Input', pricing.input, '/1M');
      push('Output', pricing.output, '/1M');
      push('Cache Read', pricing.cacheRead, '/1M');
      push('Cache Write', pricing.cacheWrite, '/1M');
      push('Reasoning', pricing.reasoning, '/1M');
      break;
    }
    case 'image': {
      // Per-image OR token-based (gpt-image-1) — show whichever is set.
      push('Image', pricing.image, '/image');
      push('Input', pricing.input, '/1M');
      push('Output', pricing.output, '/1M');
      break;
    }
    case 'video': {
      push('Video', pricing.video, '/video');
      push('Per sec', pricing.videoSeconds, '/s');
      break;
    }
    case 'audio': {
      // Per-character (TTS), token-based (TTS), or per-second (STT) — show
      // whichever is set.
      push('Per 1M chars', pricing.audioCharacters, '');
      push('Input', pricing.audioInput, '/1M');
      push('Output', pricing.audioOutput, '/1M');
      push('Per sec', pricing.audioSeconds, '/s');
      break;
    }
  }
  return lines;
}

type PricingRow = Awaited<ReturnType<typeof listPricingWithModels>>[number];

const helper = createAppColumnHelper<PricingRow>();

const pricingColumns = (edit: (row: PricingRow) => void) =>
  helper.columns([
    helper.display({
      id: 'icon',
      header: 'Icon',
      meta: { headClassName: 'w-20' },
      cell: ({ row }) =>
        row.original.image ? (
          <ModelIcon image={row.original.image} className="size-8" />
        ) : (
          <div className="size-8 rounded border bg-muted" />
        )
    }),
    helper.accessor('name', {
      header: 'Model',
      cell: ({ row }) => (
        <>
          <div className="font-medium">{row.original.name}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {row.original.modelId}
          </div>
        </>
      )
    }),
    helper.accessor(row => row.provider?.name, {
      id: 'provider',
      header: 'Provider',
      meta: { cellClassName: 'text-sm' },
      cell: ({ row }) => row.original.provider?.name ?? '-'
    }),
    helper.accessor('capability', {
      header: 'Capability',
      cell: ({ row }) => (
        <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          {row.original.capability}
        </span>
      )
    }),
    helper.display({
      id: 'pricing',
      header: 'Pricing',
      meta: {
        headClassName: 'w-56',
        cellClassName: 'font-mono text-xs text-muted-foreground'
      },
      cell: ({ row }) => {
        const lines = summarizePricing(
          row.original.capability,
          row.original.pricing
        );
        if (lines.length === 0) return '—';
        return (
          <div className="space-y-0.5">
            {lines.map(line => (
              <div key={line}>{line}</div>
            ))}
          </div>
        );
      }
    }),
    helper.accessor(row => row.pricing?.source, {
      id: 'source',
      header: 'Source',
      meta: { align: 'right', cellClassName: 'text-xs text-muted-foreground' },
      cell: ({ row }) => row.original.pricing?.source ?? '—'
    }),
    helper.display({
      id: 'actions',
      header: 'Actions',
      meta: { align: 'right', headClassName: 'w-24' },
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => edit(row.original)}>
          <Pencil className="size-4" />
        </Button>
      )
    })
  ]);

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

  const { data: rows, isLoading } = useQuery(pricingQueries.listWithModels());

  const upsertMutation = useMutation({
    mutationFn: mutating(upsertPricing),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: pricingQueries.key.listWithModels()
      });
      setEdit(null);
      toast.success('Pricing saved');
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
  // For 1-source mode: a Set of modelDbIds (checked rows).
  // For 2-source mode: per-row pick (modelDbId → source picked, or absent = skip).
  const [picks, setPicks] = useState<Map<string, PricingSource>>(new Map());

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.toLowerCase().trim();
    return rows.filter(r => {
      if (filterCapability !== 'all' && r.capability !== filterCapability)
        return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.modelId.toLowerCase().includes(q) ||
        r.provider?.name.toLowerCase().includes(q)
      );
    });
  }, [rows, search, filterCapability]);

  const form = useAppForm({
    defaultValues: EMPTY_PRICING,
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

  const openEdit = (row: PricingRow) => {
    setEdit({
      modelDbId: row.id,
      modelName: row.name,
      capability: row.capability
    });
    form.reset({
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
    });
  };

  const columns = useMemo(() => pricingColumns(openEdit), []);

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
        onChange: () => clears?.forEach(other => form.setFieldValue(other, ''))
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
      // Merge by modelDbId. All sources should return the same models.
      const merged = new Map<string, PreviewRow>();
      for (const { source, rows } of results) {
        for (const r of rows) {
          const entry = merged.get(r.modelDbId) ?? {
            modelDbId: r.modelDbId,
            modelId: r.modelId,
            modelName: r.modelName,
            current: r.current,
            sources: {
              'models.dev': { matched: false, remote: null },
              'llm-metadata': { matched: false, remote: null }
            }
          };
          entry.sources[source] = { matched: r.matched, remote: r.remote };
          // Keep latest current (they should be the same).
          entry.current = r.current;
          merged.set(r.modelDbId, entry);
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
    const groups: Record<PricingSource, string[]> = {
      'models.dev': [],
      'llm-metadata': []
    };
    for (const [modelDbId, src] of picks.entries()) {
      groups[src].push(modelDbId);
    }
    try {
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      for (const source of previewSources) {
        const ids = groups[source];
        if (ids.length === 0) continue;
        const result = await syncMutation.mutateAsync({
          source,
          modelDbIds: ids
        });
        created += result.created;
        updated += result.updated;
        unchanged += result.unchanged;
      }
      queryClient.invalidateQueries({
        queryKey: pricingQueries.key.listWithModels()
      });
      setPreviewOpen(false);
      toast.success(
        `Applied: ${created} new, ${updated} updated${unchanged ? `, ${unchanged} unchanged` : ''}`
      );
    } catch {
      // Toast already shown in onError.
    }
  };

  if (isLoading) {
    return <ConsoleTableSkeleton columns={7} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex max-w-2xl flex-1 items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search models..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            items={capabilityFilterLabels}
            value={filterCapability}
            onValueChange={onSelect(setFilterCapability)}
          >
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
        </div>

        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger
            render={
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
            }
          />
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
      </div>

      <DataTable columns={columns} data={filtered} empty="No models found." />

      <Dialog open={!!edit} onOpenChange={open => !open && setEdit(null)}>
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
                  <div className="-mx-6 grid max-h-[60vh] grid-cols-2 gap-4 overflow-y-auto px-6">
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
                  </div>
                )}
              </form.Subscribe>
              <DialogFooter className="mt-4">
                <form.Subscribe selector={state => state.isSubmitting}>
                  {isSubmitting => (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEdit(null)}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                  )}
                </form.Subscribe>
                <form.AppForm>
                  <form.SubmitButton>Save</form.SubmitButton>
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

  const togglePick = (modelDbId: string, source: PricingSource | null) => {
    setPicks(prev => {
      const next = new Map(prev);
      if (source === null) next.delete(modelDbId);
      else next.set(modelDbId, source);
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
  const allMatchedFor = (src: PricingSource) => {
    const list = matchedVisibleBySource[src];
    return list.length > 0 && list.every(r => picks.get(r.modelDbId) === src);
  };
  const togglePickAllFor = (src: PricingSource, on: boolean) => {
    const ids = matchedVisibleBySource[src].map(r => r.modelDbId);
    setPicks(prev => {
      const next = new Map(prev);
      for (const id of ids) {
        if (on) next.set(id, src);
        else if (next.get(id) === src) next.delete(id);
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
                  const pick = picks.get(r.modelDbId);
                  return (
                    <tr
                      key={r.modelDbId}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="p-2 align-middle">
                        <div className="font-mono text-sm">{r.modelId}</div>
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
                                  if (c) togglePick(r.modelDbId, src);
                                  else if (isPicked)
                                    togglePick(r.modelDbId, null);
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
