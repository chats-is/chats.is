import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

import { type ModelCapability } from '@/types/model';
import { CAPABILITIES } from '@/lib/constant';
import { mutating, type Output } from '@/lib/mutation';
import { modelQueries } from '@/server/functions/model';
import {
  providerQueries,
  syncProviderModels
} from '@/server/functions/provider';
import { settingsQueries } from '@/server/functions/settings';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

/** The columns the header and the body tables share, so they line up: the
 *  box, the model id taking the rest, and the capability. */
function SyncColgroup() {
  return (
    <colgroup>
      <col style={{ width: '48px' }} />
      <col />
      <col style={{ width: '168px' }} />
    </colgroup>
  );
}

type ProviderModelSyncDialogProps = {
  open: boolean;
  providerId: string | null;
  providerName?: string;
  onOpenChange: (open: boolean) => void;
};

export function ProviderModelSyncDialog({
  open,
  providerId,
  providerName,
  onOpenChange
}: ProviderModelSyncDialogProps) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<
    Record<string, ModelCapability>
  >({});
  // Narrows the list by model id. What is checked stays checked out of
  // sight, and is synced with the rest.
  const [search, setSearch] = useState('');

  const {
    data: models,
    isLoading: isLoadingModels,
    error
  } = useQuery({
    ...providerQueries.remoteModels({ providerId: providerId || '' }),
    enabled: open && !!providerId,
    // A provider that refuses — a wrong key, an unknown endpoint — refuses
    // again: said at once rather than after retries. Opening the dialog again
    // asks again.
    retry: false
  });

  const syncMutation = useMutation({
    mutationFn: mutating(syncProviderModels),
    onSuccess: (result: Output<typeof syncProviderModels>) => {
      queryClient.invalidateQueries({ queryKey: providerQueries.all() });
      queryClient.invalidateQueries({ queryKey: modelQueries.all() });
      queryClient.invalidateQueries({
        queryKey: settingsQueries.key.system()
      });
      reset();
      onOpenChange(false);
      toast.success(
        `Synced ${result.created} models${
          result.skipped ? `, skipped ${result.skipped} existing` : ''
        }`
      );
    },
    onError: error => toast.error(error.message)
  });

  const term = search.trim().toLowerCase();
  const shownModels = term
    ? (models ?? []).filter(model => model.modelId.toLowerCase().includes(term))
    : (models ?? []);
  // The new models in view: what the header's box checks and unchecks.
  const newModels = shownModels.filter(model => !model.exists);
  const allNewModelsSelected =
    newModels.length > 0 &&
    newModels.every(model => selectedIds.includes(model.modelId));

  useEffect(() => {
    if (!models) return;

    // Nothing is checked to begin with: a provider lists far more models than
    // anyone means to add, and which ones is the admin's to pick.
    setCapabilities(
      Object.fromEntries(models.map(model => [model.modelId, 'chat']))
    );
  }, [models]);

  const reset = () => {
    setSelectedIds([]);
    setCapabilities({});
    setSearch('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      reset();
    }
    onOpenChange(nextOpen);
  };

  const toggleSelection = (modelId: string, checked: boolean) => {
    setSelectedIds(current =>
      checked
        ? Array.from(new Set([...current, modelId]))
        : current.filter(id => id !== modelId)
    );
  };

  const setModelCapability = (modelId: string, capability: ModelCapability) => {
    setCapabilities(current => ({
      ...current,
      [modelId]: capability
    }));
  };

  const toggleAll = (checked: boolean) => {
    const ids = newModels.map(model => model.modelId);
    setSelectedIds(current =>
      checked
        ? Array.from(new Set([...current, ...ids]))
        : current.filter(id => !ids.includes(id))
    );
  };

  const syncSelectedModels = () => {
    if (!providerId || !models) return;

    syncMutation.mutate({
      providerId,
      items: models
        .filter(model => selectedIds.includes(model.modelId))
        .map(model => ({
          modelId: model.modelId,
          capability: capabilities[model.modelId] ?? 'chat'
        }))
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sync API Models</DialogTitle>
          <DialogDescription>
            {providerName
              ? `Select models from ${providerName} to write into the model table.`
              : 'Select models to write into the model table.'}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by model id..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="overflow-hidden rounded-md border">
          {/* Header table — never scrolls */}
          <table className="w-full table-fixed">
            <SyncColgroup />
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2">
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={allNewModelsSelected}
                      disabled={newModels.length === 0}
                      onCheckedChange={checked => toggleAll(checked === true)}
                    />
                  </div>
                </th>
                <th className="px-2 py-3 text-left text-sm font-medium">
                  Model
                </th>
                <th className="px-2 py-3 text-left text-sm font-medium">
                  Capability
                </th>
              </tr>
            </thead>
          </table>

          {/* Body table — scrolls, its scrollbar hidden so it fills the width
              and lines up with the header's columns. */}
          <div className="max-h-[55vh] [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden">
            <table className="w-full table-fixed">
              <SyncColgroup />
              <tbody>
                {/* A model the provider reports. One already in the model
                    table is shown for context but cannot be selected again. */}
                {!isLoadingModels &&
                  shownModels.map(model => (
                    <tr
                      key={model.modelId}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="p-2 align-middle">
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={selectedIds.includes(model.modelId)}
                            disabled={model.exists}
                            onCheckedChange={checked =>
                              toggleSelection(model.modelId, checked === true)
                            }
                          />
                        </div>
                      </td>
                      <td className="p-2 align-middle">
                        <div className="font-mono text-sm break-all">
                          {model.modelId}
                        </div>
                      </td>
                      <td className="p-2 align-middle">
                        <Select
                          value={capabilities[model.modelId] ?? 'chat'}
                          onValueChange={value =>
                            setModelCapability(
                              model.modelId,
                              value as ModelCapability
                            )
                          }
                          disabled={model.exists || syncMutation.isPending}
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CAPABILITIES.map(capability => (
                              <SelectItem
                                key={capability.value}
                                value={capability.value}
                              >
                                {capability.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                {(isLoadingModels || shownModels.length === 0) && (
                  <tr>
                    <td
                      colSpan={3}
                      className="p-6 text-center text-muted-foreground"
                    >
                      {isLoadingModels ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="size-4 animate-spin" />
                          Loading models…
                        </span>
                      ) : error && !models ? (
                        // Why the provider gave no list, in its own words.
                        <span className="text-destructive">
                          Couldn’t fetch models from the provider:{' '}
                          {error.message}
                        </span>
                      ) : !models?.length ? (
                        'No models returned from provider API.'
                      ) : (
                        'No model ids match your search.'
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter>
          {/* At the left of the buttons, once there is a list to count. */}
          {models && (
            <span className="self-center text-sm text-muted-foreground sm:mr-auto">
              {models.filter(model => !model.exists).length} new models,{' '}
              {models.filter(model => model.exists).length} existing
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={syncMutation.isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="gap-2"
            disabled={selectedIds.length === 0 || syncMutation.isPending}
            onClick={syncSelectedModels}
          >
            {syncMutation.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {syncMutation.isPending
              ? 'Syncing...'
              : `Sync ${selectedIds.length} Models`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
