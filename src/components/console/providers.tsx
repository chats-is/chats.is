import { useState, type ChangeEvent } from 'react'
import { Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import type {
  ProviderType,
  VertexAuthMode,
  VertexServiceAccountKey,
} from '@/types'
import { ProviderTypes } from '@/lib/constant'
import { api } from '@/trpc/react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { IconPicker } from '@/components/console/icon-picker'
import { ProviderModelSyncDialog } from '@/components/console/provider-model-sync-dialog'
import { ModelIcon } from '@/components/model-icon'

export default function ProvidersPage() {
  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [vertexMaskedApiKey, setVertexMaskedApiKey] = useState('')
  const [modelSyncProviderId, setModelSyncProviderId] = useState<string | null>(
    null,
  )

  const utils = api.useUtils()
  const { data: providers, isLoading } = api.provider.list.useQuery()

  const createMutation = api.provider.create.useMutation({
    onSuccess: () => {
      utils.provider.list.invalidate()
      setIsOpen(false)
      resetForm()
    },
    onError: (error) => toast.error(error.message),
  })

  const updateMutation = api.provider.update.useMutation({
    onSuccess: () => {
      utils.provider.list.invalidate()
      setIsOpen(false)
      setEditingId(null)
      resetForm()
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteMutation = api.provider.delete.useMutation({
    onSuccess: () => {
      utils.provider.list.invalidate()
      setDeleteId(null)
    },
    onError: (error) => toast.error(error.message),
  })

  const toggleMutation = api.provider.toggleEnabled.useMutation({
    onSuccess: () => {
      utils.provider.list.invalidate()
    },
    onError: (error) => toast.error(error.message),
  })

  const [formData, setFormData] = useState({
    name: '',
    type: 'openai' as ProviderType,
    apiKey: '',
    vertexAuthMode: 'service_account' as VertexAuthMode,
    vertexLocation: '',
    image: '',
    baseUrl: '',
    isEnabled: true,
    apiOptions: '',
  })

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'openai',
      apiKey: '',
      vertexAuthMode: 'service_account',
      vertexLocation: '',
      image: '',
      baseUrl: '',
      isEnabled: true,
      apiOptions: '',
    })
    setVertexMaskedApiKey('')
  }

  const modelSyncProvider = providers?.find(
    (provider) => provider.id === modelSyncProviderId,
  )

  const openModelSyncDialog = (providerId: string) => {
    setModelSyncProviderId(providerId)
  }

  const closeModelSyncDialog = () => {
    setModelSyncProviderId(null)
  }

  const handleEdit = (provider: any) => {
    const maskedVertexKey =
      provider.type === 'vertex' &&
      typeof provider.maskedKey === 'object' &&
      provider.maskedKey !== null &&
      !Array.isArray(provider.maskedKey) &&
      typeof provider.maskedKey.location === 'string' &&
      typeof provider.maskedKey.credentials === 'object' &&
      provider.maskedKey.credentials !== null &&
      !Array.isArray(provider.maskedKey.credentials)
        ? {
            location: provider.maskedKey.location,
            credentials: provider.maskedKey
              .credentials as VertexServiceAccountKey['credentials'],
          }
        : null

    setEditingId(provider.id)
    setFormData({
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
        : '',
    })
    setVertexMaskedApiKey(
      maskedVertexKey
        ? JSON.stringify(maskedVertexKey.credentials, null, 2)
        : '',
    )
    setIsOpen(true)
  }

  const handleTypeChange = (value: string) => {
    const nextType = value as ProviderType

    setFormData((current) => ({
      ...current,
      type: nextType,
      apiKey:
        current.type === 'vertex' || nextType === 'vertex'
          ? ''
          : current.apiKey,
      vertexAuthMode:
        nextType === 'vertex' ? 'service_account' : current.vertexAuthMode,
      vertexLocation: nextType === 'vertex' ? current.vertexLocation : '',
    }))
    setVertexMaskedApiKey('')
  }

  const handleVertexCredentialChange = async (
    e: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]

    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        toast.error('Credential file must contain a JSON object')
        return
      }

      const credentials = parsed as NonNullable<
        VertexServiceAccountKey['credentials']
      >

      if (
        typeof credentials.project_id !== 'string' ||
        !credentials.project_id.trim()
      ) {
        toast.error('Credential file must include project_id')
        return
      }

      setFormData((current) => ({
        ...current,
        apiKey: JSON.stringify(credentials, null, 2),
      }))
      setVertexMaskedApiKey('')
    } catch {
      toast.error('Invalid credential JSON file')
    } finally {
      e.target.value = ''
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    let apiKey = formData.apiKey.trim()
    let apiOptions: Record<string, unknown> | null | undefined
    const editingProvider = providers?.find((p) => p.id === editingId)
    const editingVertexKey =
      editingProvider?.type === 'vertex' &&
      typeof editingProvider.maskedKey === 'object' &&
      editingProvider.maskedKey !== null &&
      !Array.isArray(editingProvider.maskedKey) &&
      typeof editingProvider.maskedKey.location === 'string' &&
      typeof editingProvider.maskedKey.credentials === 'object' &&
      editingProvider.maskedKey.credentials !== null &&
      !Array.isArray(editingProvider.maskedKey.credentials)
        ? {
            location: editingProvider.maskedKey.location,
            credentials: editingProvider.maskedKey
              .credentials as VertexServiceAccountKey['credentials'],
          }
        : null
    const editingVertexAuthMode =
      editingProvider?.type === 'vertex'
        ? editingVertexKey
          ? 'service_account'
          : 'api_key'
        : null
    const requiresJsonApiKey =
      (formData.type === 'vertex' &&
        formData.vertexAuthMode === 'service_account') ||
      formData.type === 'bedrock'
    const vertexLocation = formData.vertexLocation.trim()

    if (requiresJsonApiKey && apiKey) {
      try {
        const parsedApiKey = JSON.parse(apiKey) as unknown

        if (
          typeof parsedApiKey !== 'object' ||
          parsedApiKey === null ||
          Array.isArray(parsedApiKey)
        ) {
          throw new Error('Provider secret must be a JSON object')
        }
      } catch {
        toast.error('API Key must be valid JSON for Vertex/Bedrock')
        return
      }
    }

    if (
      formData.type === 'vertex' &&
      formData.vertexAuthMode === 'service_account'
    ) {
      if (!vertexLocation) {
        toast.error('Vertex location is required')
        return
      }

      if (!editingId && !apiKey) {
        toast.error('Upload a Google Cloud credential JSON file')
        return
      }

      if (editingId && !apiKey && editingVertexAuthMode !== 'service_account') {
        toast.error('Upload a Google Vertex AI credential JSON file.')
        return
      }

      if (apiKey) {
        const credentials = JSON.parse(
          apiKey,
        ) as VertexServiceAccountKey['credentials']

        apiKey = JSON.stringify({
          location: vertexLocation,
          credentials,
        })
      } else if (editingId && editingVertexAuthMode === 'service_account') {
        apiKey = JSON.stringify({
          location: vertexLocation,
        })
      }
    }

    if (
      editingId &&
      formData.type === 'vertex' &&
      formData.vertexAuthMode === 'api_key' &&
      !apiKey &&
      editingVertexAuthMode !== 'api_key'
    ) {
      toast.error('Enter a Google Cloud API Key')
      return
    }

    try {
      if (formData.apiOptions) {
        apiOptions = JSON.parse(formData.apiOptions)
        if (
          typeof apiOptions !== 'object' ||
          apiOptions === null ||
          Array.isArray(apiOptions)
        ) {
          toast.error('API Options must be a JSON object')
          return
        }
      } else {
        // create: omit the field (undefined); update: clear it (null)
        apiOptions = editingId ? null : undefined
      }
    } catch {
      toast.error('Invalid JSON format')
      return
    }

    const {
      apiKey: _apiKey,
      vertexAuthMode: _vertexAuthMode,
      vertexLocation: _vertexLocation,
      ...providerData
    } = formData
    const data = {
      ...providerData,
      ...(apiKey && { apiKey }),
      apiOptions,
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...data })
    } else {
      createMutation.mutate(data as Parameters<typeof createMutation.mutate>[0])
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending
  const isVertex = formData.type === 'vertex'
  const isBedrock = formData.type === 'bedrock'
  const isVertexServiceAccount =
    isVertex && formData.vertexAuthMode === 'service_account'
  const isVertexApiKey = isVertex && formData.vertexAuthMode === 'api_key'
  const vertexCredentialValue =
    isVertexServiceAccount && !formData.apiKey && vertexMaskedApiKey
      ? vertexMaskedApiKey
      : formData.apiKey
  const isMaskedVertexCredential =
    isVertexServiceAccount && !formData.apiKey && !!vertexMaskedApiKey

  const apiKeyPlaceholder = (() => {
    const editingProvider = providers?.find((p) => p.id === editingId)
    const maskedKey =
      typeof editingProvider?.maskedKey === 'string'
        ? editingProvider.maskedKey
        : undefined

    if (isVertexApiKey) {
      return editingId ? maskedKey : 'Enter Google Cloud API Key'
    }
    if (isBedrock) {
      return `{
  "region": "us-east-1",
  "accessKeyId": "AKIAxxxxxxxxxxxxxxxx",
  "secretAccessKey": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "sessionToken": "optional"
}`
    }
    return editingId ? maskedKey : 'Enter API Key'
  })()

  const requiresJsonApiKey = isVertexServiceAccount || isBedrock

  const apiKeyHelpText = isVertexApiKey
    ? 'Google Cloud API key for Gemini on Vertex AI.'
    : isBedrock
      ? 'Bedrock: paste JSON containing region and AWS credentials.'
      : null

  const filteredProviders = providers?.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.type.toLowerCase().includes(search.toLowerCase()),
  )

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        Loading...
      </div>
    )
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
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger
            render={
              <Button
                className="gap-2"
                onClick={() => {
                  setEditingId(null)
                  resetForm()
                }}
              >
                <Plus className="size-4" />
                Add Provider
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingId ? 'Edit Provider' : 'Add Provider'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="-mx-6 max-h-[60vh] space-y-4 overflow-y-auto px-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="OpenAI"
                    disabled={isPending}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={handleTypeChange}
                    disabled={isPending}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ProviderTypes.map((id) => (
                        <SelectItem key={id.value} value={id.value}>
                          {id.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  {isVertex ? (
                    <>
                      <Label htmlFor="vertexAuthMode">Authentication</Label>
                      <Select
                        value={formData.vertexAuthMode}
                        onValueChange={(value) =>
                          setFormData((current) => ({
                            ...current,
                            vertexAuthMode: value as VertexAuthMode,
                            apiKey: '',
                          }))
                        }
                        disabled={isPending}
                      >
                        <SelectTrigger id="vertexAuthMode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="service_account">JSON</SelectItem>
                          <SelectItem value="api_key">
                            API Key (Gemini only)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {isVertexServiceAccount ? (
                    <>
                      <Label htmlFor="vertexCredentials">Credential File</Label>
                      <Input
                        key="vertex-service-account-file"
                        id="vertexCredentials"
                        type="file"
                        accept=".json,application/json"
                        onChange={handleVertexCredentialChange}
                        disabled={isPending}
                      />
                      <p className="text-xs text-muted-foreground">
                        Upload a Google Vertex AI credential JSON file.
                      </p>
                      <Textarea
                        id="apiKey"
                        value={vertexCredentialValue}
                        onChange={(e) =>
                          setFormData({ ...formData, apiKey: e.target.value })
                        }
                        placeholder="{}"
                        required={!editingId}
                        disabled={isPending}
                        readOnly={isMaskedVertexCredential}
                        // Credentials are one unbroken token (a key, or JSON
                        // wrapping a base64 blob). Without break-all there is no
                        // wrap opportunity, and the shared Textarea's
                        // field-sizing-content then grows it past the dialog.
                        className="font-mono break-all"
                        rows={6}
                      />
                    </>
                  ) : isVertexApiKey ? (
                    <>
                      <Label htmlFor="apiKey">API Key</Label>
                      <Input
                        key="vertex-api-key-input"
                        id="apiKey"
                        value={formData.apiKey}
                        onChange={(e) =>
                          setFormData({ ...formData, apiKey: e.target.value })
                        }
                        placeholder={apiKeyPlaceholder}
                        required={!editingId}
                        disabled={isPending}
                      />
                      {apiKeyHelpText ? (
                        <p className="text-xs text-muted-foreground">
                          {apiKeyHelpText}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Label htmlFor="apiKey">API Key</Label>
                      <Textarea
                        id="apiKey"
                        value={formData.apiKey}
                        onChange={(e) =>
                          setFormData({ ...formData, apiKey: e.target.value })
                        }
                        placeholder={apiKeyPlaceholder}
                        required={!editingId}
                        disabled={isPending}
                        className="font-mono break-all"
                        rows={requiresJsonApiKey ? 6 : 2}
                      />
                      {apiKeyHelpText ? (
                        <p className="text-xs text-muted-foreground">
                          {apiKeyHelpText}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
                {isVertexServiceAccount ? (
                  <div className="space-y-2">
                    <Label htmlFor="vertexLocation">Location</Label>
                    <Input
                      id="vertexLocation"
                      value={formData.vertexLocation}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          vertexLocation: e.target.value,
                        })
                      }
                      placeholder="us-central1"
                      disabled={isPending}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter the Google Vertex AI region, e.g. us-central1.
                    </p>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="baseUrl">Base URL (optional)</Label>
                  <Input
                    id="baseUrl"
                    value={formData.baseUrl}
                    onChange={(e) =>
                      setFormData({ ...formData, baseUrl: e.target.value })
                    }
                    placeholder="https://"
                    disabled={isPending}
                  />
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
                      onChange={(e) =>
                        setFormData({ ...formData, image: e.target.value })
                      }
                      placeholder="https:// or Base64 or IconName (e.g. Gemini.Color)"
                      disabled={isPending}
                    />
                  </div>
                  <IconPicker
                    value={formData.image}
                    onChange={(value) =>
                      setFormData({
                        ...formData,
                        image: value,
                      })
                    }
                    disabled={isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apiOptions">API Options (JSON)</Label>
                  <Textarea
                    id="apiOptions"
                    value={formData.apiOptions}
                    onChange={(e) =>
                      setFormData({ ...formData, apiOptions: e.target.value })
                    }
                    placeholder="{}"
                    disabled={isPending}
                    className="font-mono break-all"
                    rows={3}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="isEnabled"
                    checked={formData.isEnabled}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isEnabled: checked })
                    }
                    disabled={isPending}
                  />
                  <Label htmlFor="isEnabled">Enabled</Label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsOpen(false)}
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
              <th className="p-3 text-left text-sm font-medium">Name</th>
              <th className="w-28 p-3 text-left text-sm font-medium">Type</th>
              <th className="w-20 p-3 text-center text-sm font-medium">
                Models
              </th>
              <th className="w-20 p-3 text-center text-sm font-medium">
                Enabled
              </th>
              <th className="w-36 p-3 text-right text-sm font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredProviders?.map((provider) => (
              <tr
                key={provider.id}
                className="border-b transition-colors hover:bg-muted/30"
              >
                <td className="p-3">
                  {provider.image ? (
                    <ModelIcon image={provider.image} className="size-8" />
                  ) : (
                    <div className="size-8 rounded border bg-muted" />
                  )}
                </td>
                <td className="p-3">{provider.name}</td>
                <td className="p-3">
                  <span className="rounded bg-muted px-2 py-1 text-xs">
                    {provider.type}
                  </span>
                </td>
                <td className="p-3 text-center">
                  {provider.models?.length || 0}
                </td>
                <td className="p-3 text-center">
                  <Switch
                    checked={provider.isEnabled}
                    onCheckedChange={(checked) =>
                      toggleMutation.mutate({
                        id: provider.id,
                        isEnabled: checked,
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
                          onClick={() => openModelSyncDialog(provider.id)}
                        >
                          <RefreshCw className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>Sync API Models</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(provider)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>Edit Provider</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDeleteId(provider.id)
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      }
                    />
                    <TooltipContent>Delete Provider</TooltipContent>
                  </Tooltip>
                </td>
              </tr>
            ))}
            {(!filteredProviders || filteredProviders.length === 0) && (
              <tr>
                <td
                  colSpan={6}
                  className="p-6 text-center text-muted-foreground"
                >
                  {search
                    ? 'No providers found matching your search.'
                    : 'No providers configured. Add your first provider to get started.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
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
                  deleteMutation.mutate({ id: deleteId })
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
        providerName={modelSyncProvider?.name}
        onOpenChange={(open) => {
          if (!open) {
            closeModelSyncDialog()
          }
        }}
      />
    </div>
  )
}
