import { CornerDownRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A model's providers, as the console's tables show them: in failover order,
 * each with the id it routes to where that is not the model's own, and struck
 * through where the binding or the provider itself is switched off — either
 * way it serves nothing. The whole of what a binding says
 * about who serves a model, so the model and pricing tables say it alike.
 */
export function ProviderBindings({
  bindings
}: {
  bindings: Array<{
    id: string;
    isEnabled: boolean;
    providerModelId?: string | null;
    provider?: { name: string; isEnabled: boolean } | null;
  }>;
}) {
  const served = bindings.filter(binding => binding.provider);
  if (served.length === 0) return '-';

  return (
    <div className="space-y-0.5">
      {served.map(binding => (
        // The id it routes to on a line of its own, under the provider's
        // name, rather than wrapping beside it in a narrow column.
        <div key={binding.id} className="flex flex-col">
          <span
            className={cn(
              (!binding.isEnabled || !binding.provider!.isEnabled) &&
                'line-through'
            )}
          >
            {binding.provider!.name}
          </span>
          {binding.providerModelId && (
            <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
              <CornerDownRight className="size-3 shrink-0" />
              {binding.providerModelId}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
