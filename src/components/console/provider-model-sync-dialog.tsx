import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import type { ModelCapability } from '@/types/model';
import { CAPABILITIES } from '@/lib/constant';
import { mutating } from '@/lib/mutation';
import { onSelect } from '@/lib/select';
import { modelQueries } from '@/server/fn/model';
import { providerQueries, syncProviderModels } from '@/server/fn/provider';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

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
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: models,
    isLoading,
    isFetching
  } = useQuery({
    ...providerQueries.remoteModels({ providerId: providerId || '' }),
    enabled: open && !!providerId,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false
  });

  const syncMutation = useMutation({
    mutationFn: mutating(syncProviderModels),
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: providerQueries.key.list() });
      queryClient.invalidateQueries({ queryKey: modelQueries.key.list() });
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

  const newModels = models?.filter(model => !model.exists) ?? [];
  const allNewModelsSelected =
    newModels.length > 0 &&
    newModels.every(model => selectedIds.includes(model.modelId));
  const isLoadingModels = isLoading || isRefreshing;

  useEffect(() => {
    if (!models) return;

    setSelectedIds(
      models.filter(model => !model.exists).map(model => model.modelId)
    );
    setCapabilities(
      Object.fromEntries(models.map(model => [model.modelId, 'chat']))
    );
  }, [models]);

  const reset = () => {
    setSelectedIds([]);
    setCapabilities({});
    setIsRefreshing(false);
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

  const refreshModels = async () => {
    if (!providerId) return;

    setIsRefreshing(true);
    try {
      queryClient.setQueryData(
        providerQueries.remoteModels({ providerId }).queryKey,
        undefined
      );
      setSelectedIds([]);
      setCapabilities({});
      const refreshedModels = await utils.provider.fetchModels.fetch({
        providerId
      });
      queryClient.setQueryData(
        providerQueries.remoteModels({ providerId }).queryKey,
        refreshedModels
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to refresh models'
      );
    } finally {
      setIsRefreshing(false);
    }
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

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {models
              ? `${newModels.length} new models, ${models.length - newModels.length} existing`
              : 'Fetching models from provider API'}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={isFetching || isRefreshing}
            onClick={refreshModels}
          >
            {isFetching || isRefreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
        </div>

        <div className="max-h-[55vh] overflow-auto rounded-md border">
          {isLoadingModels ? (
            <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading models...
            </div>
          ) : models && models.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="w-12 p-0 text-sm font-medium">
                    <div className="flex min-h-11 items-center justify-center">
                      <Checkbox
                        checked={allNewModelsSelected}
                        disabled={!newModels.length}
                        onCheckedChange={checked => {
                          setSelectedIds(
                            checked ? newModels.map(model => model.modelId) : []
                          );
                        }}
                      />
                    </div>
                  </th>
                  <th className="p-3 text-left text-sm font-medium">Model</th>
                  <th className="w-36 p-3 text-left text-sm font-medium">
                    Capability
                  </th>
                </tr>
              </thead>
              <tbody>
                {models.map(model => {
                  const isSelected = selectedIds.includes(model.modelId);

                  return (
                    <tr
                      key={model.modelId}
                      className="border-b transition-colors hover:bg-muted/30"
                    >
                      <td className="w-12 p-0 align-middle">
                        <div className="flex min-h-14 items-center justify-center">
                          <Checkbox
                            checked={isSelected}
                            disabled={model.exists}
                            onCheckedChange={checked =>
                              toggleSelection(model.modelId, checked === true)
                            }
                          />
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-mono text-sm">{model.modelId}</div>
                      </td>
                      <td className="p-3 align-top">
                        <Select
                          value={capabilities[model.modelId] ?? 'chat'}
                          onValueChange={onSelect(value =>
                            setModelCapability(
                              model.modelId,
                              value as ModelCapability
                            )
                          )}
                          disabled={model.exists || syncMutation.isPending}
                        >
                          <SelectTrigger className="w-32">
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
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              No models returned from provider API.
            </div>
          )}
        </div>

        <DialogFooter>
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
