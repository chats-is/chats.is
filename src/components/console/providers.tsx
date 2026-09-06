import { useMemo, useState, type ChangeEvent } from 'react';
import { useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  type ProviderType,
  type VertexAuthMode,
  type VertexServiceAccountKey
} from '@/types';
import { ProviderTypes } from '@/lib/constant';
import { mutating } from '@/lib/mutation';
import {
  createProvider,
  deleteProvider,
  providerQueries,
  toggleEnabledProvider,
  updateProvider,
  type listProviders
} from '@/server/fn/provider';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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
import { ProviderModelSyncDialog } from '@/components/console/provider-model-sync-dialog';
import { ConsoleTableSkeleton } from '@/components/console/skeletons';
import { ModelIcon } from '@/components/model-icon';

type Provider = Awaited<ReturnType<typeof listProviders>>[number];

type ProviderForm = {
  name: string;
  type: ProviderType;
  apiKey: string;
  vertexAuthMode: VertexAuthMode;
  vertexLocation: string;
  image: string;
  baseUrl: string;
  isEnabled: boolean;
  apiOptions: string;
};

const EMPTY_FORM: ProviderForm = {
  name: '',
  type: 'openai',
  apiKey: '',
  vertexAuthMode: 'service_account',
  vertexLocation: '',
  image: '',
  baseUrl: '',
  isEnabled: true,
  apiOptions: ''
};

const PROVIDER_TYPE_OPTIONS = ProviderTypes.map(t => ({
  value: t.value,
  label: t.label
}));

const VERTEX_AUTH_OPTIONS = [
  { value: 'service_account', label: 'JSON' },
  { value: 'api_key', label: 'API Key (Gemini only)' }
];

/** Parses to a JSON object (not an array, not a scalar). */
const isJsonObject = (text: string): boolean => {
  try {
    const parsed = JSON.parse(text) as unknown;
    return (
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
};

/** The service-account key stored on a provider, if it has one. */
const vertexKeyOf = (provider: Provider | undefined) => {
  const masked = provider?.maskedKey;
  if (
    provider?.type !== 'vertex' ||
    typeof masked !== 'object' ||
    masked === null ||
    Array.isArray(masked) ||
    typeof masked.location !== 'string' ||
    typeof masked.credentials !== 'object' ||
    masked.credentials === null ||
    Array.isArray(masked.credentials)
  ) {
    return null;
  }
  return {
    location: masked.location,
    credentials: masked.credentials as VertexServiceAccountKey['credentials']
  };
};

/**
 * Which of a provider's rules apply depends on what is already stored — an
 * edit may leave the secret untouched, a create may not — so the checks take
 * the record being edited alongside the typed values.
 */
const validateProvider = (
  value: ProviderForm,
  editing: { id: string | null; vertexAuthMode: VertexAuthMode | null }
) => {
  const fields: Record<string, string> = {};
  const apiKey = value.apiKey.trim();
  const isVertex = value.type === 'vertex';
  const isServiceAccount =
    isVertex && value.vertexAuthMode === 'service_account';
  const requiresJsonApiKey = isServiceAccount || value.type === 'bedrock';

  if (!value.name.trim()) fields.name = 'Name is required';

  if (requiresJsonApiKey && apiKey && !isJsonObject(apiKey)) {
    fields.apiKey = 'API Key must be valid JSON for Vertex/Bedrock';
  }

  if (isServiceAccount) {
    if (!value.vertexLocation.trim()) {
      fields.vertexLocation = 'Vertex location is required';
    }
    if (!editing.id && !apiKey) {
      fields.apiKey = 'Upload a Google Cloud credential JSON file';
    } else if (
      editing.id &&
      !apiKey &&
      editing.vertexAuthMode !== 'service_account'
    ) {
      fields.apiKey = 'Upload a Google Vertex AI credential JSON file.';
    }
  } else if (isVertex) {
    if (editing.id && !apiKey && editing.vertexAuthMode !== 'api_key') {
      fields.apiKey = 'Enter a Google Cloud API Key';
    }
    if (!editing.id && !apiKey) fields.apiKey = 'Enter a Google Cloud API Key';
  } else if (!editing.id && !apiKey) {
    fields.apiKey = 'API Key is required';
  }

  if (value.apiOptions.trim() && !isJsonObject(value.apiOptions)) {
    fields.apiOptions = 'API Options must be a JSON object';
  }

  return Object.keys(fields).length > 0 ? { fields } : undefined;
};

const helper = createAppColumnHelper<Provider>();

const providerColumns = (actions: {
  toggle: (provider: Provider, isEnabled: boolean) => void;
  sync: (id: string) => void;
  edit: (provider: Provider) => void;
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
    helper.accessor('name', { header: 'Name' }),
    helper.accessor('type', {
      header: 'Type',
      meta: { headClassName: 'w-28' },
      cell: ({ row }) => (
        <span className="rounded bg-muted px-2 py-1 text-xs">
          {row.original.type}
        </span>
      )
    }),
    helper.accessor(row => row.models?.length || 0, {
      id: 'models',
      header: 'Models',
      meta: { align: 'center', headClassName: 'w-20' }
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
        headClassName: 'w-36',
        cellClassName: 'whitespace-nowrap'
      },
      cell: ({ row }) => (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => actions.sync(row.original.id)}
              >
                <RefreshCw className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Sync API Models</TooltipContent>
          </Tooltip>
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
            <TooltipContent>Edit Provider</TooltipContent>
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
            <TooltipContent>Delete Provider</TooltipContent>
          </Tooltip>
        </>
      )
    })
  ]);

export default function ProvidersPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [vertexMaskedApiKey, setVertexMaskedApiKey] = useState('');
  const [modelSyncProviderId, setModelSyncProviderId] = useState<string | null>(
    null
  );

  const queryClient = useQueryClient();
  const { data: providers, isLoading } = useQuery(providerQueries.list());

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: providerQueries.key.list() });

  const createMutation = useMutation({
    mutationFn: mutating(createProvider),
    onSuccess: invalidate
  });

  const updateMutation = useMutation({
    mutationFn: mutating(updateProvider),
    onSuccess: invalidate
  });

  const deleteMutation = useMutation({
    mutationFn: mutating(deleteProvider),
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
    },
    onError: error => toast.error(error.message)
  });

  const toggleMutation = useMutation({
    mutationFn: mutating(toggleEnabledProvider),
    onSuccess: invalidate,
    onError: error => toast.error(error.message)
  });

  const editingProvider = providers?.find(p => p.id === editingId);
  const editingVertexKey = vertexKeyOf(editingProvider);
  const editingVertexAuthMode: VertexAuthMode | null =
    editingProvider?.type === 'vertex'
      ? editingVertexKey
        ? 'service_account'
        : 'api_key'
      : null;

  const form = useAppForm({
    defaultValues: EMPTY_FORM,
    validators: {
      onChange: ({ value }) =>
        validateProvider(value, {
          id: editingId,
          vertexAuthMode: editingVertexAuthMode
        })
    },
    onSubmit: async ({ value }) => {
      let apiKey = value.apiKey.trim();

      if (
        value.type === 'vertex' &&
        value.vertexAuthMode === 'service_account'
      ) {
        const location = value.vertexLocation.trim();
        if (apiKey) {
          apiKey = JSON.stringify({
            location,
            credentials: JSON.parse(
              apiKey
            ) as VertexServiceAccountKey['credentials']
          });
        } else if (editingId && editingVertexAuthMode === 'service_account') {
          // The stored credentials stay put; only the location is resent.
          apiKey = JSON.stringify({ location });
        }
      }

      // create: omit the field (undefined); update: clear it (null)
      const apiOptions = value.apiOptions
        ? (JSON.parse(value.apiOptions) as Record<string, unknown>)
        : editingId
          ? null
          : undefined;

      const {
        apiKey: _apiKey,
        vertexAuthMode: _vertexAuthMode,
        vertexLocation: _vertexLocation,
        ...providerData
      } = value;
      const payload = {
        ...providerData,
        ...(apiKey && { apiKey }),
        apiOptions
      };

      try {
        if (editingId) {
          await updateMutation.mutateAsync({ id: editingId, ...payload });
        } else {
          await createMutation.mutateAsync(
            payload as Parameters<typeof createMutation.mutateAsync>[0]
          );
        }
        setIsOpen(false);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  });

  const openFor = (provider: Provider | null) => {
    setEditingId(provider?.id ?? null);

    if (!provider) {
      form.reset(EMPTY_FORM);
      setVertexMaskedApiKey('');
      setIsOpen(true);
      return;
    }

    const maskedVertexKey = vertexKeyOf(provider);
    form.reset({
      name: provider.name,
      type: provider.type,
      apiKey: '',
      vertexAuthMode: maskedVertexKey ? 'service_account' : 'api_key',
      vertexLocation: maskedVertexKey?.location || '',
      image: provider.image || '',
      baseUrl: provider.baseUrl || '',
      isEnabled: provider.isEnabled,
      apiOptions: provider.apiOptions
        ? JSON.stringify(provider.apiOptions, null, 2)
        : ''
    });
    setVertexMaskedApiKey(
      maskedVertexKey
        ? JSON.stringify(maskedVertexKey.credentials, null, 2)
        : ''
    );
    setIsOpen(true);
  };

  const columns = useMemo(
    () =>
      providerColumns({
        toggle: (provider, isEnabled) =>
          toggleMutation.mutate({ id: provider.id, isEnabled }),
        sync: setModelSyncProviderId,
        edit: openFor,
        remove: setDeleteId
      }),
    []
  );

  // Changing the type invalidates the secret it was entered for.
  const handleTypeChange = (nextType: ProviderType) => {
    const currentType = form.getFieldValue('type');
    if (currentType === 'vertex' || nextType === 'vertex') {
      form.setFieldValue('apiKey', '');
    }
    if (nextType === 'vertex') {
      form.setFieldValue('vertexAuthMode', 'service_account');
    } else {
      form.setFieldValue('vertexLocation', '');
    }
    setVertexMaskedApiKey('');
  };

  const handleVertexCredentialChange = async (
    e: ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        toast.error('Credential file must contain a JSON object');
        return;
      }

      const credentials = parsed as NonNullable<
        VertexServiceAccountKey['credentials']
      >;

      if (
        typeof credentials.project_id !== 'string' ||
        !credentials.project_id.trim()
      ) {
        toast.error('Credential file must include project_id');
        return;
      }

      form.setFieldValue('apiKey', JSON.stringify(credentials, null, 2));
      setVertexMaskedApiKey('');
    } catch {
      toast.error('Invalid credential JSON file');
    } finally {
      e.target.value = '';
    }
  };

  // One field at a time: the store compares by identity, so a selector
  // returning a fresh object would re-render the page on every keystroke.
  const type = useStore(form.store, state => state.values.type);
  const vertexAuthMode = useStore(
    form.store,
    state => state.values.vertexAuthMode
  );
  const isVertex = type === 'vertex';
  const isBedrock = type === 'bedrock';
  const isVertexServiceAccount =
    isVertex && vertexAuthMode === 'service_account';
  const isVertexApiKey = isVertex && vertexAuthMode === 'api_key';
  const requiresJsonApiKey = isVertexServiceAccount || isBedrock;

  const apiKeyPlaceholder = (() => {
    const maskedKey =
      typeof editingProvider?.maskedKey === 'string'
        ? editingProvider.maskedKey
        : undefined;

    if (isVertexApiKey) {
      return editingId ? maskedKey : 'Enter Google Cloud API Key';
    }
    if (isBedrock) {
      return `{
  "region": "us-east-1",
  "accessKeyId": "AKIAxxxxxxxxxxxxxxxx",
  "secretAccessKey": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "sessionToken": "optional"
}`;
    }
    return editingId ? maskedKey : 'Enter API Key';
  })();

  const apiKeyHelpText = isVertexApiKey
    ? 'Google Cloud API key for Gemini on Vertex AI.'
    : isBedrock
      ? 'Bedrock: paste JSON containing region and AWS credentials.'
      : null;

  const filteredProviders = providers?.filter(
    p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.type.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) {
    return <ConsoleTableSkeleton columns={6} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex max-w-2xl flex-1 items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search providers..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={() => openFor(null)}>
              <Plus className="size-4" />
              Add Provider
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingId ? 'Edit Provider' : 'Add Provider'}
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
                <form.AppField name="name">
                  {field => (
                    <field.TextField label="Name" placeholder="OpenAI" />
                  )}
                </form.AppField>

                <form.AppField
                  name="type"
                  listeners={{
                    onChange: ({ value }) => handleTypeChange(value)
                  }}
                >
                  {field => (
                    <field.SelectField
                      label="Type"
                      options={PROVIDER_TYPE_OPTIONS}
                    />
                  )}
                </form.AppField>

                {isVertex && (
                  <form.AppField
                    name="vertexAuthMode"
                    listeners={{
                      onChange: () => form.setFieldValue('apiKey', '')
                    }}
                  >
                    {field => (
                      <field.SelectField
                        label="Authentication"
                        options={VERTEX_AUTH_OPTIONS}
                      />
                    )}
                  </form.AppField>
                )}

                <form.Field name="apiKey">
                  {field => {
                    const error = field.state.meta.isTouched
                      ? field.state.meta.errors[0]
                      : null;
                    const errorLine = error ? (
                      <p className="text-xs text-destructive">
                        {String(
                          (error as { message?: string })?.message ?? error
                        )}
                      </p>
                    ) : null;

                    if (isVertexServiceAccount) {
                      // With nothing newly typed, the stored credential is
                      // shown masked and read-only — it is not re-sent.
                      const masked = !field.state.value && !!vertexMaskedApiKey;
                      return (
                        <div className="space-y-2">
                          <Label htmlFor="vertexCredentials">
                            Credential File
                          </Label>
                          <Input
                            key="vertex-service-account-file"
                            id="vertexCredentials"
                            type="file"
                            accept=".json,application/json"
                            onChange={handleVertexCredentialChange}
                          />
                          <p className="text-xs text-muted-foreground">
                            Upload a Google Vertex AI credential JSON file.
                          </p>
                          <Textarea
                            id="apiKey"
                            value={
                              masked ? vertexMaskedApiKey : field.state.value
                            }
                            onChange={e => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder="{}"
                            readOnly={masked}
                            aria-invalid={!!error}
                            // Credentials are one unbroken token (a key, or JSON
                            // wrapping a base64 blob). Without break-all there is
                            // no wrap opportunity, and the shared Textarea's
                            // field-sizing-content then grows it past the dialog.
                            className="font-mono break-all"
                            rows={6}
                          />
                          {errorLine}
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        <Label htmlFor="apiKey">API Key</Label>
                        {isVertexApiKey ? (
                          <Input
                            key="vertex-api-key-input"
                            id="apiKey"
                            value={field.state.value}
                            onChange={e => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder={apiKeyPlaceholder}
                            aria-invalid={!!error}
                          />
                        ) : (
                          <Textarea
                            id="apiKey"
                            value={field.state.value}
                            onChange={e => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            placeholder={apiKeyPlaceholder}
                            aria-invalid={!!error}
                            className="font-mono break-all"
                            rows={requiresJsonApiKey ? 6 : 2}
                          />
                        )}
                        {apiKeyHelpText ? (
                          <p className="text-xs text-muted-foreground">
                            {apiKeyHelpText}
                          </p>
                        ) : null}
                        {errorLine}
                      </div>
                    );
                  }}
                </form.Field>

                {isVertexServiceAccount && (
                  <form.AppField name="vertexLocation">
                    {field => (
                      <field.TextField
                        label="Location"
                        placeholder="us-central1"
                        hint="Enter the Google Vertex AI region, e.g. us-central1."
                      />
                    )}
                  </form.AppField>
                )}

                <form.AppField name="baseUrl">
                  {field => (
                    <field.TextField
                      label="Base URL (optional)"
                      placeholder="https://"
                    />
                  )}
                </form.AppField>

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

                <form.AppField name="apiOptions">
                  {field => (
                    <field.TextareaField
                      label="API Options (JSON)"
                      placeholder="{}"
                      className="font-mono break-all"
                      rows={3}
                    />
                  )}
                </form.AppField>

                <form.AppField name="isEnabled">
                  {field => <field.SwitchField label="Enabled" />}
                </form.AppField>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsOpen(false)}
                >
                  Cancel
                </Button>
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
        data={filteredProviders}
        empty={
          search
            ? 'No providers found matching your search.'
            : 'No providers configured. Add your first provider to get started.'
        }
      />

      <AlertDialog
        open={!!deleteId}
        onOpenChange={open => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this provider? This action cannot
              be undone.
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

      <ProviderModelSyncDialog
        open={!!modelSyncProviderId}
        providerId={modelSyncProviderId}
        providerName={providers?.find(p => p.id === modelSyncProviderId)?.name}
        onOpenChange={open => {
          if (!open) setModelSyncProviderId(null);
        }}
      />
    </div>
  );
}
