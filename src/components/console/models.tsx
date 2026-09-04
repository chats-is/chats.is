import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { CAPABILITIES } from '@/lib/constant';
import { mutating } from '@/lib/mutation';
import { onSelect } from '@/lib/select';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  createModel,
  deleteModel,
  modelQueries,
  toggleEnabledModel,
  updateModel,
  type listModels
} from '@/server/fn/model';
import { providerQueries } from '@/server/fn/provider';
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
import { IconPicker } from '@/components/console/icon-picker';
import { ModelIcon } from '@/components/model-icon';

type Model = Awaited<ReturnType<typeof listModels>>[number];

const capabilityFilterLabels = {
  all: 'All Capabilities',
  ...Object.fromEntries(CAPABILITIES.map(c => [c.value, c.label]))
};

const CAPABILITY_OPTIONS = CAPABILITIES.map(c => ({
  value: c.value,
  label: c.label
}));

/** A JSON object, or nothing. Stored as text so the admin can keep editing it. */
const jsonObject = z.string().refine(value => {
  if (!value.trim()) return true;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}, 'Invalid JSON format');

const modelSchema = z
  .object({
    name: z.string().trim().min(1, 'Display name is required'),
    modelId: z.string().trim().min(1, 'Model ID is required'),
    capability: z.enum(['chat', 'image', 'video', 'audio']),
    image: z.string(),
    aliases: z.string(),
    supportsVision: z.boolean(),
    supportsReasoning: z.boolean(),
    supportsImageEdit: z.boolean(),
    supportsImageToVideo: z.boolean(),
    supportsVideoEdit: z.boolean(),
    supportsTranscription: z.boolean(),
    isEnabled: z.boolean(),
    systemPrompt: z.string(),
    uiOptions: jsonObject,
    apiParams: jsonObject,
    providers: z.array(
      z.object({ providerId: z.string(), isEnabled: z.boolean() })
    )
  })
  // A model is only reachable through a provider, and the list is a failover
  // order — so it needs at least one, and no provider twice.
  .superRefine((value, ctx) => {
    const chosen = value.providers
      .map(binding => binding.providerId)
      .filter(Boolean);

    if (chosen.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['providers'],
        message: 'At least one provider is required'
      });
    }
    if (new Set(chosen).size !== chosen.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['providers'],
        message: 'Each provider can only be added once'
      });
    }
  });

type ModelForm = z.infer<typeof modelSchema>;

const EMPTY_FORM: ModelForm = {
  name: '',
  modelId: '',
  capability: 'chat',
  image: '',
  aliases: '',
  supportsVision: false,
  supportsReasoning: false,
  supportsImageEdit: false,
  supportsImageToVideo: false,
  supportsVideoEdit: false,
  supportsTranscription: false,
  isEnabled: true,
  systemPrompt: '',
  uiOptions: '',
  apiParams: '',
  providers: [{ providerId: '', isEnabled: true }]
};

const uiOptionsPlaceholderByCapability: Record<string, string> = {
  chat: `{
  "reasoning": false
}`,
  image: `{
  "size": "auto",
  "sizes": ["auto", "1024x1024"],
  "aspectRatio": "auto",
  "aspectRatios": ["auto", "16:9"]
}`,
  video: `{
  "duration": 6,
  "durations": [4, 6, 8],
  "resolution": "auto",
  "resolutions": ["auto", "720p"],
  "aspectRatio": "auto",
  "aspectRatios": ["auto", "16:9"]
}`,
  audio: `{
  "voice": "auto",
  "voices": ["auto"]
}`
};

const apiParamsPlaceholderByCapability: Record<string, string> = {
  chat: `{
  "temperature": 0.7,
  "topP": 1,
  "topK": 0,
  "maxOutputTokens": 4096,
  "frequencyPenalty": 0,
  "presencePenalty": 0
}`,
  image: '{\n}',
  video: '{}',
  audio: '{}'
};

/** The capability switches that only apply to some kinds of model. */
const CONDITIONAL_TOGGLES = [
  {
    name: 'supportsImageEdit',
    label: 'Image editing',
    capability: 'image'
  },
  {
    name: 'supportsImageToVideo',
    label: 'Image to video',
    capability: 'video'
  },
  {
    name: 'supportsVideoEdit',
    label: 'Video editing',
    capability: 'video'
  },
  {
    name: 'supportsTranscription',
    label: 'Transcription (STT)',
    capability: 'audio'
  }
] as const;

/** A JSON textarea's help bubble, showing the shape it expects. */
const JsonHint = ({ label, example }: { label: string; example: string }) => (
  <div className="flex items-center gap-2">
    <Label>{label}</Label>
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="text-muted-foreground/60 hover:text-muted-foreground"
            aria-label={`${label} demo`}
          >
            <AlertCircle className="size-3.5" />
          </button>
        }
      />
      <TooltipContent className="max-w-sm">
        <pre className="font-mono text-xs whitespace-pre-wrap">{example}</pre>
      </TooltipContent>
    </Tooltip>
  </div>
);

const helper = createAppColumnHelper<Model>();

const modelColumns = (actions: {
  toggle: (model: Model, isEnabled: boolean) => void;
  edit: (model: Model) => void;
  remove: (id: string) => void;
}) =>
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
    helper.accessor('aliases', {
      header: 'Aliases',
      meta: { cellClassName: 'text-sm text-muted-foreground' },
      cell: ({ row }) => row.original.aliases?.join(', ') || '-'
    }),
    helper.display({
      id: 'provider',
      header: 'Provider',
      meta: { cellClassName: 'text-sm' },
      cell: ({ row }) => {
        const bound = row.original.modelProviders ?? [];
        return bound.length > 0
          ? bound
              .map(mp => mp.provider?.name)
              .filter(Boolean)
              .join(', ')
          : row.original.provider?.name;
      }
    }),
    helper.accessor('capability', {
      header: 'Capability',
      cell: ({ row }) => (
        <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          {row.original.capability}
        </span>
      )
    }),
    helper.accessor('isEnabled', {
      header: 'Enabled',
      meta: { align: 'center', headClassName: 'w-20' },
      cell: ({ row }) => (
        <Switch
          checked={row.original.isEnabled}
          onCheckedChange={checked => actions.toggle(row.original, checked)}
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
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => actions.edit(row.original)}
                >
                  <Pencil className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Edit Model</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => actions.remove(row.original.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Delete Model</TooltipContent>
          </Tooltip>
        </>
      )
    })
  ]);

export default function ModelsPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterCapability, setFilterCapability] = useSearchFilter(
    'capability',
    'all'
  );
  const [search, setSearch] = useSearchFilter('q', '');

  const queryClient = useQueryClient();
  const { data: models, isLoading } = useQuery(modelQueries.list());
  const { data: providers } = useQuery(providerQueries.list());

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: modelQueries.key.list() });

  const createMutation = useMutation({
    mutationFn: mutating(createModel),
    onSuccess: invalidate
  });

  const updateMutation = useMutation({
    mutationFn: mutating(updateModel),
    onSuccess: invalidate
  });

  const deleteMutation = useMutation({
    mutationFn: mutating(deleteModel),
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
    },
    onError: error => toast.error(error.message)
  });

  const toggleMutation = useMutation({
    mutationFn: mutating(toggleEnabledModel),
    onSuccess: invalidate,
    onError: error => toast.error(error.message)
  });

  const form = useAppForm({
    defaultValues: EMPTY_FORM,
    validators: { onChange: modelSchema },
    onSubmit: async ({ value }) => {
      // Validated above, so these parse. An absent field clears the stored
      // value on an edit, and stays unset on a create.
      const uiOptions = value.uiOptions
        ? JSON.parse(value.uiOptions)
        : editingId
          ? null
          : undefined;
      const apiParams = value.apiParams
        ? JSON.parse(value.apiParams)
        : editingId
          ? null
          : undefined;
      const systemPrompt = value.systemPrompt || (editingId ? null : undefined);
      const aliases = value.aliases
        ? value.aliases
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : editingId
          ? []
          : undefined;

      const payload = {
        ...value,
        aliases,
        systemPrompt,
        uiOptions,
        apiParams,
        // The list's order is the failover order.
        providers: value.providers
          .filter(b => b.providerId)
          .map((b, index) => ({
            providerId: b.providerId,
            priority: index,
            isEnabled: b.isEnabled
          }))
      };

      try {
        if (editingId) {
          await updateMutation.mutateAsync({ id: editingId, ...payload });
        } else {
          await createMutation.mutateAsync(payload);
        }
        setIsOpen(false);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  });

  const openFor = (model: Model | null) => {
    setEditingId(model?.id ?? null);

    if (!model) {
      form.reset(EMPTY_FORM);
      setIsOpen(true);
      return;
    }

    const bindings = (model.modelProviders ?? [])
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map(b => ({ providerId: b.providerId, isEnabled: b.isEnabled }));

    form.reset({
      name: model.name,
      modelId: model.modelId,
      capability: model.capability,
      image: model.image || '',
      aliases: model.aliases?.join(', ') || '',
      supportsVision: model.supportsVision || false,
      supportsReasoning: model.supportsReasoning || false,
      supportsImageEdit: model.supportsImageEdit || false,
      supportsImageToVideo: model.supportsImageToVideo || false,
      supportsVideoEdit: model.supportsVideoEdit || false,
      supportsTranscription: model.supportsTranscription || false,
      isEnabled: model.isEnabled,
      systemPrompt: model.systemPrompt || '',
      uiOptions: model.uiOptions
        ? JSON.stringify(model.uiOptions, null, 2)
        : '',
      apiParams: model.apiParams
        ? JSON.stringify(model.apiParams, null, 2)
        : '',
      providers:
        bindings.length > 0
          ? bindings
          : [{ providerId: model.providerId || '', isEnabled: true }]
    });
    setIsOpen(true);
  };

  const columns = useMemo(
    () =>
      modelColumns({
        toggle: (model, isEnabled) =>
          toggleMutation.mutate({ id: model.id, isEnabled }),
        edit: openFor,
        remove: setDeleteId
      }),
    []
  );

  // Debounce the modelId before querying compatible providers, so typing in the
  // Model ID field doesn't fan out a /models call to every provider per keystroke.
  const typedModelId = useStore(form.store, state => state.values.modelId);
  const [debouncedModelId, setDebouncedModelId] = useState('');
  useEffect(() => {
    const trimmed = typedModelId.trim();
    const timer = setTimeout(() => setDebouncedModelId(trimmed), 400);
    return () => clearTimeout(timer);
  }, [typedModelId]);

  // Providers that actually support the entered modelId — the only ones a
  // binding may select (same-kind failover).
  const { data: compatibleProviders } = useQuery({
    ...providerQueries.compatible({ modelId: debouncedModelId }),
    enabled: isOpen && !!debouncedModelId,
    refetchOnWindowFocus: false,
    retry: false
  });

  const filteredModels = models?.filter(m => {
    const matchesCapability =
      filterCapability === 'all' || m.capability === filterCapability;
    const matchesSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.modelId.toLowerCase().includes(search.toLowerCase()) ||
      m.provider?.name.toLowerCase().includes(search.toLowerCase());

    return matchesCapability && matchesSearch;
  });

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

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger
            render={
              <Button className="gap-2" onClick={() => openFor(null)}>
                <Plus className="size-4" />
                Add Model
              </Button>
            }
          />
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingId ? 'Edit Model' : 'Add Model'}
              </DialogTitle>
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
                      <field.TextField
                        label="Display Name"
                        placeholder="GPT-4o"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="modelId">
                    {field => (
                      <field.TextField
                        label="Model ID"
                        placeholder="gpt-4o"
                        // A model's id is its identity everywhere else, so an
                        // existing one is not renamed here.
                        disabled={!!editingId}
                      />
                    )}
                  </form.AppField>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label>Providers (priority order, auto failover)</Label>
                    <form.Field name="providers" mode="array">
                      {providersField => (
                        <div className="space-y-2">
                          {providersField.state.value.map((binding, index) => {
                            const options = compatibleProviders ?? [];
                            // An already-bound provider that the current model
                            // id is no longer compatible with still has to be
                            // shown, or the row would look empty.
                            const selectedMissing =
                              !!binding.providerId &&
                              !options.some(p => p.id === binding.providerId);
                            const selectedName =
                              providers?.find(p => p.id === binding.providerId)
                                ?.name ?? binding.providerId;

                            const selectOptions = [
                              ...(selectedMissing
                                ? [
                                    {
                                      value: binding.providerId,
                                      label: selectedName
                                    }
                                  ]
                                : []),
                              ...options.map(p => ({
                                value: p.id,
                                label: p.name,
                                disabled: providersField.state.value.some(
                                  (b, i) => i !== index && b.providerId === p.id
                                )
                              }))
                            ];

                            return (
                              <div
                                key={index}
                                className="flex items-center gap-2 rounded-md border p-2"
                              >
                                <form.AppField
                                  name={`providers[${index}].providerId`}
                                >
                                  {field => (
                                    <field.SelectField
                                      placeholder="Select provider"
                                      options={selectOptions}
                                      fieldClassName="flex-1 space-y-0"
                                    />
                                  )}
                                </form.AppField>
                                <form.Field
                                  name={`providers[${index}].isEnabled`}
                                >
                                  {field => (
                                    <Switch
                                      checked={field.state.value}
                                      onCheckedChange={checked =>
                                        field.handleChange(checked)
                                      }
                                    />
                                  )}
                                </form.Field>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={index === 0}
                                  onClick={() =>
                                    providersField.swapValues(index - 1, index)
                                  }
                                >
                                  <ArrowUp className="size-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={
                                    index ===
                                    providersField.state.value.length - 1
                                  }
                                  onClick={() =>
                                    providersField.swapValues(index, index + 1)
                                  }
                                >
                                  <ArrowDown className="size-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={
                                    providersField.state.value.length === 1
                                  }
                                  onClick={() =>
                                    providersField.removeValue(index)
                                  }
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            );
                          })}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() =>
                              providersField.pushValue({
                                providerId: '',
                                isEnabled: true
                              })
                            }
                          >
                            <Plus className="size-4" />
                            Add provider
                          </Button>
                          {providersField.state.meta.isTouched &&
                            providersField.state.meta.errors[0] && (
                              <p className="text-xs text-destructive">
                                {String(
                                  (
                                    providersField.state.meta.errors[0] as {
                                      message?: string;
                                    }
                                  )?.message ??
                                    providersField.state.meta.errors[0]
                                )}
                              </p>
                            )}
                        </div>
                      )}
                    </form.Field>
                  </div>
                  <form.AppField name="aliases">
                    {field => (
                      <field.TextField
                        label="Model ID Aliases (optional)"
                        placeholder="gpt-4, gpt-4-turbo"
                      />
                    )}
                  </form.AppField>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <form.AppField name="capability">
                    {field => (
                      <field.SelectField
                        label="Capability"
                        options={CAPABILITY_OPTIONS}
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="systemPrompt">
                    {field => (
                      <field.TextareaField
                        label="System Prompt (optional)"
                        placeholder="Instructions prepended to every chat with this model. Supports {provider}, {modelId}, {date}."
                        rows={4}
                      />
                    )}
                  </form.AppField>
                </div>

                <form.Field name="image">
                  {field => (
                    <div className="space-y-2">
                      <Label htmlFor="image">Icon (optional)</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 shadow-sm">
                          {field.state.value ? (
                            <ModelIcon
                              image={field.state.value}
                              className="size-4"
                            />
                          ) : null}
                        </div>
                        <Input
                          id="image"
                          value={field.state.value}
                          onChange={e => field.handleChange(e.target.value)}
                          placeholder="https:// or Base64 or IconName (e.g. Gemini.Color)"
                        />
                      </div>
                      <IconPicker
                        value={field.state.value}
                        onChange={value => field.handleChange(value)}
                      />
                    </div>
                  )}
                </form.Field>

                <form.Subscribe selector={state => state.values.capability}>
                  {capability => (
                    <div className="grid grid-cols-1 gap-4">
                      <form.AppField name="uiOptions">
                        {field => (
                          <field.TextareaField
                            label={
                              <JsonHint
                                label="UI Options (JSON)"
                                example={
                                  uiOptionsPlaceholderByCapability[
                                    capability
                                  ] ?? '{\n}'
                                }
                              />
                            }
                            placeholder={
                              uiOptionsPlaceholderByCapability[capability] ??
                              '{\n}'
                            }
                            className="font-mono break-all"
                            rows={3}
                          />
                        )}
                      </form.AppField>
                      <form.AppField name="apiParams">
                        {field => (
                          <field.TextareaField
                            label={
                              <JsonHint
                                label="API Params (JSON)"
                                example={
                                  apiParamsPlaceholderByCapability[
                                    capability
                                  ] ?? '{}'
                                }
                              />
                            }
                            placeholder={
                              apiParamsPlaceholderByCapability[capability] ??
                              '{}'
                            }
                            className="font-mono break-all"
                            rows={3}
                          />
                        )}
                      </form.AppField>
                    </div>
                  )}
                </form.Subscribe>

                <form.Subscribe selector={state => state.values.capability}>
                  {capability => (
                    <div className="flex flex-wrap gap-4">
                      <form.AppField name="supportsVision">
                        {field => <field.SwitchField label="Vision" />}
                      </form.AppField>
                      <form.AppField name="supportsReasoning">
                        {field => <field.SwitchField label="Reasoning" />}
                      </form.AppField>
                      {CONDITIONAL_TOGGLES.filter(
                        toggle => toggle.capability === capability
                      ).map(toggle => (
                        <form.AppField key={toggle.name} name={toggle.name}>
                          {field => <field.SwitchField label={toggle.label} />}
                        </form.AppField>
                      ))}
                      <form.AppField name="isEnabled">
                        {field => <field.SwitchField label="Enabled" />}
                      </form.AppField>
                    </div>
                  )}
                </form.Subscribe>
              </div>

              <div className="flex justify-end gap-2">
                <form.Subscribe selector={state => state.isSubmitting}>
                  {isSubmitting => (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsOpen(false)}
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
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <DataTable
        columns={columns}
        data={filteredModels}
        empty="No models configured. Add your first model to get started."
      />

      <AlertDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Model</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this model? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) {
                  deleteMutation.mutate({ id: deleteId });
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
