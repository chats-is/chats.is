import { cn } from '@/lib/utils';

/**
 * A model's providers, as the console's tables show them: in failover order,
 * each with the id it routes to where that is not the model's own, and struck
 * through where the binding is switched off. The whole of what a binding says
 * about who serves a model, so the model and pricing tables say it alike.
 */
export function ProviderBindings({
  bindings
}: {
  bindings: Array<{
    id: string;
    isEnabled: boolean;
    providerModelId?: string | null;
    provider?: { name: string } | null;
  }>;
}) {
  const served = bindings.filter(binding => binding.provider);
  if (served.length === 0) return '-';

  return (
    <div className="space-y-0.5">
      {served.map(binding => (
        <div key={binding.id} className="flex items-baseline gap-1.5">
          <span className={cn(!binding.isEnabled && 'line-through')}>
            {binding.provider!.name}
          </span>
          {binding.providerModelId && (
            <span className="font-mono text-xs text-muted-foreground">
              → {binding.providerModelId}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
