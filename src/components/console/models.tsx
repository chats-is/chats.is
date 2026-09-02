import { useEffect, useState } from 'react';
import { api } from '@/trpc/react';
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

import { type ModelCapability } from '@/types';
import { CAPABILITIES } from '@/lib/constant';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { IconPicker } from '@/components/console/icon-picker';
import { ModelIcon } from '@/components/model-icon';

type ProviderBindingForm = {
  providerId: string;
  isEnabled: boolean;
};

function ProviderBindingRow({
  binding,
  index,
  bindings,
  providers,
  allProviders,
  isPending,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove
}: {
  binding: ProviderBindingForm;
  index: number;
  bindings: ProviderBindingForm[];
  /** Providers compatible with the model id (same-kind) — the only selectable ones. */
  providers: { id: string; name: string }[] | undefined;
  /** All providers, used to label an already-selected but now-incompatible one. */
  allProviders: { id: string; name: string }[] | undefined;
  isPending: boolean;
  onChange: (patch: Partial<ProviderBindingForm>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const options = providers ?? [];
  const selectedMissing =
    !!binding.providerId && !options.some(p => p.id === binding.providerId);
  const selectedName =
    allProviders?.find(p => p.id === binding.providerId)?.name ??
    binding.providerId;

  return (
    <div className="flex items-center gap-2 rounded-md border p-2">
      <Select
        value={binding.providerId || undefined}
        onValueChange={value => onChange({ providerId: value })}
        disabled={isPending}
      >
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Select provider" />
        </SelectTrigger>
        <SelectContent>
          {selectedMissing && (
            <SelectItem value={binding.providerId}>{selectedName}</SelectItem>
          )}
          {options.map(p => {
            const takenByOther = bindings.some(
              (b, i) => i !== index && b.providerId === p.id
            );
            return (
              <SelectItem key={p.id} value={p.id} disabled={takenByOther}>
                {p.name}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Switch
        checked={binding.isEnabled}
        onCheckedChange={checked => onChange({ isEnabled: checked })}
        disabled={isPending}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isPending || index === 0}
        onClick={onMoveUp}
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isPending || index === bindings.length - 1}
        onClick={onMoveDown}
      >
        <ArrowDown className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isPending || bindings.length === 1}
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

export default function ModelsPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterCapability, setFilterCapability] = useState<string>('all');
  const [search, setSearch] = useState('');

  const utils = api.useUtils();
  const { data: models, isLoading } = api.model.list.useQuery();
  const { data: providers } = api.provider.list.useQuery();

  const createMutation = api.model.create.useMutation({
    onSuccess: () => {
      utils.model.list.invalidate();
      setIsOpen(false);
      resetForm();
    },
    onError: error => toast.error(error.message)
  });

  const updateMutation = api.model.update.useMutation({
    onSuccess: () => {
      utils.model.list.invalidate();
      setIsOpen(false);
      setEditingId(null);
      resetForm();
    },
    onError: error => toast.error(error.message)
  });

  const deleteMutation = api.model.delete.useMutation({
    onSuccess: () => {
      utils.model.list.invalidate();
      setDeleteId(null);
    },
    onError: error => toast.error(error.message)
  });

  const toggleMutation = api.model.toggleEnabled.useMutation({
    onSuccess: () => {
      utils.model.list.invalidate();
    },
    onError: error => toast.error(error.message)
  });

  const [formData, setFormData] = useState({
    name: '',
    modelId: '',
    capability: 'chat' as ModelCapability,
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
    apiParams: ''
  });

  const [providerBindings, setProviderBindings] = useState<
    ProviderBindingForm[]
  >([]);

  // Debounce the modelId before querying compatible providers, so typing in the
  // Model ID field doesn't fan out a /models call to every provider per keystroke.
  const [debouncedModelId, setDebouncedModelId] = useState('');
  useEffect(() => {
    const trimmed = formData.modelId.trim();
    const timer = setTimeout(() => setDebouncedModelId(trimmed), 400);
    return () => clearTimeout(timer);
  }, [formData.modelId]);

  // Providers that actually support the entered modelId — the only ones a
  // binding may select (same-kind failover).
  const { data: compatibleProviders } =
    api.provider.compatibleProviders.useQuery(
      { modelId: debouncedModelId },
      {
        enabled: isOpen && !!debouncedModelId,
        refetchOnWindowFocus: false,
        retry: false
      }
    );

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

  const uiOptionsPlaceholder =
    uiOptionsPlaceholderByCapability[formData.capability] ?? '{\n}';

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

  const apiParamsPlaceholder =
    apiParamsPlaceholderByCapability[formData.capability] ?? '{}';

  const resetForm = () => {
    setFormData({
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
      apiParams: ''
    });
    setProviderBindings([{ providerId: '', isEnabled: true }]);
  };

  const handleEdit = (model: any) => {
    setEditingId(model.id);
    setFormData({
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
      apiParams: model.apiParams ? JSON.stringify(model.apiParams, null, 2) : ''
    });
    const bindings: ProviderBindingForm[] = (model.modelProviders ?? [])
      .slice()
      .sort((a: any, b: any) => a.priority - b.priority)
      .map((b: any) => ({
        providerId: b.providerId,
        isEnabled: b.isEnabled
      }));
    setProviderBindings(
      bindings.length > 0
        ? bindings
        : [{ providerId: model.providerId || '', isEnabled: true }]
    );
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let uiOptions: Record<string, unknown> | null | undefined;
    let apiParams: Record<string, unknown> | null | undefined;
    try {
      if (formData.uiOptions) {
        uiOptions = JSON.parse(formData.uiOptions);
      } else {
        uiOptions = editingId ? null : undefined;
      }
      if (formData.apiParams) {
        apiParams = JSON.parse(formData.apiParams);
      } else {
        apiParams = editingId ? null : undefined;
      }
    } catch {
      toast.error('Invalid JSON format');
      return;
    }

    const systemPrompt =
      formData.systemPrompt || (editingId ? null : undefined);
    const aliases = formData.aliases
      ? formData.aliases
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : editingId
        ? []
        : undefined;
    const providersPayload = providerBindings
      .filter(b => b.providerId)
      .map((b, index) => ({
        providerId: b.providerId,
        priority: index,
        isEnabled: b.isEnabled
      }));
    if (providersPayload.length === 0) {
      toast.error('At least one provider is required');
      return;
    }
    const selectedProviderIds = providersPayload.map(b => b.providerId);
    if (new Set(selectedProviderIds).size !== selectedProviderIds.length) {
      toast.error('Each provider can only be added once');
      return;
    }

    const data = {
      ...formData,
      aliases,
      systemPrompt,
      uiOptions,
      apiParams,
      providers: providersPayload
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...data });
    } else {
      createMutation.mutate(
        data as Parameters<typeof createMutation.mutate>[0]
      );
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

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
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger
            render={
              <Button
                className="gap-2"
                onClick={() => {
                  setEditingId(null);
                  resetForm();
                }}
              >
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
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="-mx-6 max-h-[60vh] space-y-4 overflow-y-auto px-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Display Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={e =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      placeholder="GPT-4o"
                      required
                      disabled={isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="modelId">Model ID</Label>
                    <Input
                      id="modelId"
                      value={formData.modelId}
                      onChange={e =>
                        setFormData({ ...formData, modelId: e.target.value })
                      }
                      placeholder="gpt-4o"
                      required
                      disabled={isPending || !!editingId}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label>Providers (priority order, auto failover)</Label>
                    <div className="space-y-2">
                      {providerBindings.map((binding, index) => (
                        <ProviderBindingRow
                          key={index}
                          binding={binding}
                          index={index}
                          bindings={providerBindings}
                          providers={compatibleProviders}
                          allProviders={providers}
                          isPending={isPending}
                          onChange={patch =>
                            setProviderBindings(prev =>
                              prev.map((b, i) =>
                                i === index ? { ...b, ...patch } : b
                              )
                            )
                          }
                          onMoveUp={() =>
                            setProviderBindings(prev => {
                              if (index === 0) return prev;
                              const next = [...prev];
                              [next[index - 1], next[index]] = [
                                next[index],
                                next[index - 1]
                              ];
                              return next;
                            })
                          }
                          onMoveDown={() =>
                            setProviderBindings(prev => {
                              if (index === prev.length - 1) return prev;
                              const next = [...prev];
                              [next[index], next[index + 1]] = [
                                next[index + 1],
                                next[index]
                              ];
                              return next;
                            })
                          }
                          onRemove={() =>
                            setProviderBindings(prev =>
                              prev.filter((_, i) => i !== index)
                            )
                          }
                        />
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={isPending}
                        onClick={() =>
                          setProviderBindings(prev => [
                            ...prev,
                            { providerId: '', isEnabled: true }
                          ])
                        }
                      >
                        <Plus className="size-4" />
                        Add provider
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="aliases">Model ID Aliases (optional)</Label>
                    <Input
                      id="aliases"
                      value={formData.aliases}
                      onChange={e =>
                        setFormData({ ...formData, aliases: e.target.value })
                      }
                      placeholder="gpt-4, gpt-4-turbo"
                      disabled={isPending}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="capability">Capability</Label>
                    <Select
                      value={formData.capability}
                      onValueChange={value =>
                        setFormData({ ...formData, capability: value as any })
                      }
                      disabled={isPending}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CAPABILITIES.map(cap => (
                          <SelectItem key={cap.value} value={cap.value}>
                            {cap.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="systemPrompt">
                      System Prompt (optional)
                    </Label>
                    <Textarea
                      id="systemPrompt"
                      value={formData.systemPrompt}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          systemPrompt: e.target.value
                        })
                      }
                      placeholder="Instructions prepended to every chat with this model. Supports {provider}, {modelId}, {date}."
                      rows={4}
                      disabled={isPending}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="image">Icon (optional)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 shadow-sm">
                      {formData.image ? (
                        <ModelIcon image={formData.image} className="size-4" />
                      ) : null}
                    </div>
                    <Input
                      id="image"
                      value={formData.image}
                      onChange={e =>
                        setFormData({ ...formData, image: e.target.value })
                      }
                      placeholder="https:// or Base64 or IconName (e.g. Gemini.Color)"
                      disabled={isPending}
                    />
                  </div>
                  <IconPicker
                    value={formData.image}
                    onChange={value =>
                      setFormData({
                        ...formData,
                        image: value
                      })
                    }
                    disabled={isPending}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="uiOptions">UI Options (JSON)</Label>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              className="text-muted-foreground/60 hover:text-muted-foreground"
                              aria-label="UI Options demo"
                            >
                              <AlertCircle className="size-3.5" />
                            </button>
                          }
                        />
                        <TooltipContent className="max-w-sm">
                          <pre className="font-mono text-xs whitespace-pre-wrap">
                            {uiOptionsPlaceholder}
                          </pre>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Textarea
                      id="uiOptions"
                      value={formData.uiOptions}
                      onChange={e =>
                        setFormData({ ...formData, uiOptions: e.target.value })
                      }
                      placeholder={uiOptionsPlaceholder}
                      className="font-mono break-all"
                      rows={3}
                      disabled={isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="apiParams">API Params (JSON)</Label>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              className="text-muted-foreground/60 hover:text-muted-foreground"
                              aria-label="API Params demo"
                            >
                              <AlertCircle className="size-3.5" />
                            </button>
                          }
                        />
                        <TooltipContent className="max-w-sm">
                          <pre className="font-mono text-xs whitespace-pre-wrap">
                            {apiParamsPlaceholder}
                          </pre>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Textarea
                      id="apiParams"
                      value={formData.apiParams}
                      onChange={e =>
                        setFormData({ ...formData, apiParams: e.target.value })
                      }
                      placeholder={apiParamsPlaceholder}
                      className="font-mono break-all"
                      rows={3}
                      disabled={isPending}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="supportsVision"
                      checked={formData.supportsVision}
                      onCheckedChange={checked =>
                        setFormData({ ...formData, supportsVision: checked })
                      }
                      disabled={isPending}
                    />
                    <Label htmlFor="supportsVision">Vision</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="supportsReasoning"
                      checked={formData.supportsReasoning}
                      onCheckedChange={checked =>
                        setFormData({ ...formData, supportsReasoning: checked })
                      }
                      disabled={isPending}
                    />
                    <Label htmlFor="supportsReasoning">Reasoning</Label>
                  </div>
                  {formData.capability === 'image' && (
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="supportsImageEdit"
                        checked={formData.supportsImageEdit}
                        onCheckedChange={checked =>
                          setFormData({
                            ...formData,
                            supportsImageEdit: checked
                          })
                        }
                        disabled={isPending}
                      />
                      <Label htmlFor="supportsImageEdit">Image editing</Label>
                    </div>
                  )}
                  {formData.capability === 'video' && (
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="supportsImageToVideo"
                        checked={formData.supportsImageToVideo}
                        onCheckedChange={checked =>
                          setFormData({
                            ...formData,
                            supportsImageToVideo: checked
                          })
                        }
                        disabled={isPending}
                      />
                      <Label htmlFor="supportsImageToVideo">
                        Image to video
                      </Label>
                    </div>
                  )}
                  {formData.capability === 'video' && (
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="supportsVideoEdit"
                        checked={formData.supportsVideoEdit}
                        onCheckedChange={checked =>
                          setFormData({
                            ...formData,
                            supportsVideoEdit: checked
                          })
                        }
                        disabled={isPending}
                      />
                      <Label htmlFor="supportsVideoEdit">Video editing</Label>
                    </div>
                  )}
                  {formData.capability === 'audio' && (
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="supportsTranscription"
                        checked={formData.supportsTranscription}
                        onCheckedChange={checked =>
                          setFormData({
                            ...formData,
                            supportsTranscription: checked
                          })
                        }
                        disabled={isPending}
                      />
                      <Label htmlFor="supportsTranscription">
                        Transcription (STT)
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="isEnabled"
                      checked={formData.isEnabled}
                      onCheckedChange={checked =>
                        setFormData({ ...formData, isEnabled: checked })
                      }
                      disabled={isPending}
                    />
                    <Label htmlFor="isEnabled">Enabled</Label>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending} className="gap-2">
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  {isPending
                    ? 'Saving...'
                    : editingId
                      ? 'Save Changes'
                      : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-20 p-3 text-left text-sm font-medium">Icon</th>
              <th className="p-3 text-left text-sm font-medium">Model</th>
              <th className="p-3 text-left text-sm font-medium">Aliases</th>
              <th className="p-3 text-left text-sm font-medium">Provider</th>
              <th className="p-3 text-left text-sm font-medium">Capability</th>
              <th className="w-20 p-3 text-center text-sm font-medium">
                Enabled
              </th>
              <th className="w-24 p-3 text-right text-sm font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredModels?.map(model => (
              <tr
                key={model.id}
                className="border-b transition-colors hover:bg-muted/30"
              >
                <td className="p-3">
                  {model.image ? (
                    <ModelIcon image={model.image} className="size-8" />
                  ) : (
                    <div className="size-8 rounded border bg-muted" />
                  )}
                </td>
                <td className="p-3">
                  <div className="font-medium">{model.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {model.modelId}
                  </div>
                </td>
                <td className="p-3 text-sm text-muted-foreground">
                  {model.aliases?.join(', ') || '-'}
                </td>
                <td className="p-3 text-sm">
                  {(model.modelProviders ?? []).length > 0
                    ? (model.modelProviders ?? [])
                        .map((mp: any) => mp.provider?.name)
                        .filter(Boolean)
                        .join(', ')
                    : model.provider?.name}
                </td>
                <td className="p-3">
                  <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    {model.capability}
                  </span>
                </td>
                <td className="p-3 text-center">
                  <Switch
                    checked={model.isEnabled}
                    onCheckedChange={checked =>
                      toggleMutation.mutate({
                        id: model.id,
                        isEnabled: checked
                      })
                    }
                  />
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(model)}
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
                          onClick={() => {
                            setDeleteId(model.id);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>Delete Model</TooltipContent>
                  </Tooltip>
                </td>
              </tr>
            ))}
            {(!filteredModels || filteredModels.length === 0) && (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-muted-foreground"
                >
                  No models configured. Add your first model to get started.
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
