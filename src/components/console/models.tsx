import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { type ModelCapability, type ProviderType } from '@/types';
import { modelCapabilitySchema } from '@/types/model';
import { CAPABILITIES } from '@/lib/constant';
import { mutating } from '@/lib/mutation';
import { useEditRecord } from '@/hooks/use-edit-record';
import { useSearchFilter } from '@/hooks/use-search-filter';
import {
  createModel,
  deleteModel,
  getModel,
  modelQueries,
  toggleEnabledModel,
  updateModel,
  type listModels
} from '@/server/functions/model';
import { providerQueries } from '@/server/functions/provider';
import { settingsQueries } from '@/server/functions/settings';
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
  Popover,
  PopoverAnchor,
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
import { IconPicker, iconSearchSeed } from '@/components/console/icon-picker';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { modelTableInput } from '@/components/console/table-filters';
import {
  ConsoleFilters,
  ConsoleSearch,
  ConsoleToolbar
} from '@/components/console/toolbar';
import { UiOptionsField } from '@/components/console/ui-options-field';
import { ModelIcon } from '@/components/model-icon';

type Model = Awaited<ReturnType<typeof listModels>>['rows'][number];
/** What the edit form is filled from: the model as read when it opens. */
type EditableModel = NonNullable<Awaited<ReturnType<typeof getModel>>>;

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
    name: z.string().trim().min(1, 'Display name is required').max(100),
    modelId: z.string().trim().min(1, 'Model ID is required').max(255),
    capability: modelCapabilitySchema,
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
      z.object({
        providerId: z.string(),
        providerModelId: z.string(),
        isEnabled: z.boolean()
      })
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
  providers: [{ providerId: '', providerModelId: '', isEnabled: true }]
};

const apiParamsPlaceholderByCapability: Record<string, string> = {
  chat: `{
  "temperature": 0.7,
  "topP": 1,
  "topK": 0,
  "maxOutputTokens": 4096,
  "maxInputTokens": 128000,
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
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground/60 hover:text-muted-foreground"
          aria-label={`${label} demo`}
        >
          <AlertCircle className="size-3.5" />
        </button>
      </TooltipTrigger>
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
        return (row.original.providers ?? [])
          .map(binding => binding.provider?.name)
          .filter(Boolean)
          .join(', ');
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
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => actions.edit(row.original)}
              >
                <Pencil className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit Model</TooltipContent>
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
            <TooltipContent>Delete Model</TooltipContent>
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
export function ModelsPending() {
  return (
    <ConsoleTableSkeleton
      columns={modelColumns({ toggle: noop, edit: noop, remove: noop })}
      filters={1}
    />
  );
}

export default function ModelsPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterCapability, setFilterCapability] = useSearchFilter(
    'capability',
    'all'
  );
  const [search, setSearch] = useSearchFilter('q', '');
  const [page, setPage] = useSearchFilter('page', 1);

  const queryClient = useQueryClient();
  const { data, isLoading, isPlaceholderData } = useQuery(
    modelQueries.list(
      modelTableInput({ capability: filterCapability, q: search, page })
    )
  );
  const { data: providers } = useQuery(providerQueries.forSelect());

  // The models on offer in the chat are read from the system settings, which
  // a layout holds for a minute: a model switched off here must go off the
  // menu at once, not when that minute is up.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: modelQueries.all() });
    queryClient.invalidateQueries({ queryKey: settingsQueries.key.system() });
  };

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

  const [defaults, setDefaults] = useState(EMPTY_FORM);

  const form = useAppForm({
    defaultValues: defaults,
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
            providerModelId: b.providerModelId.trim() || null,
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

  const openFor = (model: EditableModel | null) => {
    setEditingId(model?.id ?? null);

    if (!model) {
      setDefaults(EMPTY_FORM);
      form.reset(EMPTY_FORM);
      setIsOpen(true);
      return;
    }

    const bindings = (model.providers ?? [])
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map(b => ({
        providerId: b.providerId,
        providerModelId: b.providerModelId ?? '',
        isEnabled: b.isEnabled
      }));

    const values = {
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
      // A model always has at least one binding, but the form needs a row to
      // draw even if one ever arrives without.
      providers:
        bindings.length > 0
          ? bindings
          : [{ providerId: '', providerModelId: '', isEnabled: true }]
    };
    setDefaults(values);
    form.reset(values);
    setIsOpen(true);
  };

  // Editing opens the form on the row as the table shows it, held, and fills
  // it again from the model as read now — then it can be typed in.
  const record = useEditRecord(
    id => getModel({ data: { id } }),
    'model',
    () => setIsOpen(false)
  );
  // Every way out of the dialog: a read still out for it is no longer wanted.
  const close = () => {
    record.cancel();
    setIsOpen(false);
  };
  const openEdit = async (shown: Model) => {
    openFor(shown);
    const model = await record.load(shown.id);
    if (model) openFor(model);
  };

  const columns = useMemo(
    () =>
      modelColumns({
        toggle: (model, isEnabled) =>
          toggleMutation.mutate({ id: model.id, isEnabled }),
        edit: openEdit,
        remove: setDeleteId
      }),
    []
  );

  // Every provider that is switched on. Which of them serves a given model id
  // is the admin's to know, not the provider's list to decide: a provider
  // accepts ids its listing leaves out — an alias, a dated snapshot, a
  // deployment name — and a menu gated on the listing offered nothing for
  // those. A provider bound earlier and since switched off is still shown on
  // its row, so the row does not read as empty.
  const enabledProviders = useMemo(
    () => (providers ?? []).filter(provider => provider.isEnabled),
    [providers]
  );

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

        <Dialog
          open={isOpen}
          onOpenChange={open => (open ? setIsOpen(true) : close())}
        >
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={() => openFor(null)}>
              <Plus className="size-4" />
              Add Model
            </Button>
          </DialogTrigger>
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
              <fieldset
                disabled={record.isLoading}
                className="-mx-6 max-h-[60vh] min-w-0 space-y-4 overflow-y-auto px-6"
              >
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
                  <form.AppField name="capability">
                    {field => (
                      <field.SelectField
                        label="Capability"
                        options={CAPABILITY_OPTIONS}
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="aliases">
                    {field => (
                      <field.TextField
                        label="Model ID Aliases (optional)"
                        placeholder="gpt-4, gpt-4-turbo"
                      />
                    )}
                  </form.AppField>
                </div>

                <form.Field name="providers" mode="array">
                  {providersField => (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label>Providers (priority order, auto failover)</Label>
                        {/* Beside the heading rather than under the list: the
                            list grows, and a button that moves down the
                            dialog every time one is added is a moving
                            target. */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-my-1 h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            providersField.pushValue({
                              providerId: '',
                              providerModelId: '',
                              isEnabled: true
                            })
                          }
                        >
                          <Plus className="size-4" />
                          Add
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {providersField.state.value.map((binding, index) => {
                          const options = enabledProviders;
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
                              className="flex items-center gap-1"
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
                              {/* The id this provider knows the model by,
                                  when that is not the model's own — an
                                  alias, a dated snapshot, a deployment
                                  name. Blank sends the model id. */}
                              <form.AppField
                                name={`providers[${index}].providerModelId`}
                              >
                                {field => (
                                  <field.TextField
                                    placeholder="Model id at this provider"
                                    fieldClassName="flex-1 space-y-0"
                                  />
                                )}
                              </form.AppField>
                              <form.Field
                                name={`providers[${index}].isEnabled`}
                              >
                                {field => (
                                  // A bare switch sits shorter than the
                                  // controls beside it; the shell gives it
                                  // their height and their border.
                                  <div className="flex h-9 items-center rounded-md border border-input px-2.5 shadow-xs dark:bg-input/30">
                                    <Switch
                                      checked={field.state.value}
                                      onCheckedChange={checked =>
                                        field.handleChange(checked)
                                      }
                                    />
                                  </div>
                                )}
                              </form.Field>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-9 text-muted-foreground"
                                disabled={index === 0}
                                onClick={() =>
                                  providersField.swapValues(index - 1, index)
                                }
                              >
                                <ArrowUp className="size-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="size-9 text-muted-foreground"
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
                                variant="outline"
                                size="icon"
                                className="size-9 text-muted-foreground hover:text-destructive"
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
                    </div>
                  )}
                </form.Field>

                <form.AppField name="systemPrompt">
                  {field => (
                    <field.TextareaField
                      label="System Prompt (optional)"
                      placeholder="Instructions for this model, added after the app's own system prompt."
                      rows={4}
                    />
                  )}
                </form.AppField>

                <form.Subscribe
                  selector={state =>
                    state.values.modelId || state.values.name || ''
                  }
                >
                  {identity => (
                    <form.Field name="image">
                      {field => (
                        <div className="space-y-2">
                          <Label htmlFor="image">Icon (optional)</Label>
                          {/* The preview is the way in: the catalogue is
                              long and only wanted for a moment, so it lives
                              behind the thing it sets rather than under it. */}
                          <Popover>
                            {/* The whole row anchors it, not the swatch that
                                opens it — that is what makes
                                `--radix-popover-trigger-width` the width of
                                the field instead of the width of a button. */}
                            <PopoverAnchor asChild>
                              <div className="flex items-center gap-2">
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label="Choose an icon"
                                    className="flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                                  >
                                    {field.state.value ? (
                                      <ModelIcon
                                        image={field.state.value}
                                        className="size-4"
                                      />
                                    ) : (
                                      <ImageIcon className="size-4 text-muted-foreground" />
                                    )}
                                  </button>
                                </PopoverTrigger>
                                <Input
                                  id="image"
                                  value={field.state.value}
                                  onChange={e =>
                                    field.handleChange(e.target.value)
                                  }
                                  placeholder="https:// or Base64 or IconName (e.g. Gemini.Color)"
                                />
                              </div>
                            </PopoverAnchor>
                            {/* Not portalled: the dialog's scroll lock only
                                lets the wheel through inside its own content,
                                and a portalled popover lands outside it. */}
                            <PopoverContent
                              side="top"
                              align="start"
                              portal={false}
                              className="w-(--radix-popover-trigger-width) p-0"
                            >
                              <IconPicker
                                value={field.state.value}
                                onChange={value => field.handleChange(value)}
                                initialSearch={iconSearchSeed(identity)}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      )}
                    </form.Field>
                  )}
                </form.Subscribe>

                {/* One string rather than an object, so the subscription
                    re-renders on a real change and not on every keystroke
                    that rebuilds the providers array. */}
                <form.Subscribe
                  selector={state =>
                    [
                      state.values.capability,
                      state.values.providers.map(b => b.providerId).join(','),
                      String(state.values.supportsReasoning)
                    ].join('|')
                  }
                >
                  {key => {
                    const [capability, providerIds, reasoning] = key.split('|');
                    const providerTypes = providerIds
                      .split(',')
                      .map(id => providers?.find(p => p.id === id)?.type)
                      .filter((type): type is ProviderType => !!type);

                    return (
                      <div className="grid grid-cols-1 gap-4">
                        {/* Every switch together, under the icon and above
                            the options: Reasoning decides whether two of
                            those options are reachable at all, so it has to
                            be read before them. */}
                        <div className="flex flex-wrap gap-4">
                          <form.AppField name="isEnabled">
                            {field => <field.SwitchField label="Enabled" />}
                          </form.AppField>
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
                              {field => (
                                <field.SwitchField label={toggle.label} />
                              )}
                            </form.AppField>
                          ))}
                        </div>
                        <form.Field name="uiOptions">
                          {field => (
                            <UiOptionsField
                              value={field.state.value}
                              onChange={value => field.handleChange(value)}
                              capability={capability as ModelCapability}
                              providerTypes={providerTypes}
                              supportsReasoning={reasoning === 'true'}
                            />
                          )}
                        </form.Field>
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
                    );
                  }}
                </form.Subscribe>
              </fieldset>

              <div className="flex justify-end gap-2">
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
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </ConsoleToolbar>

      <DataTable
        columns={columns}
        data={isLoading ? undefined : data?.rows}
        empty="No models configured. Add your first model to get started."
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
