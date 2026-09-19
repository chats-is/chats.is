import { type ModelStatus } from '@/types/model';
import { cn } from '@/lib/utils';

/**
 * Why a model will not answer, wherever one is listed.
 *
 * The console's selectors offer every model, the ones that cannot answer
 * included — a model is chosen here before it is switched on, and a setting
 * already pointing at one that has stopped answering has to keep saying so.
 * This is a note beside the name, not a bar across it: everything stays
 * choosable, because what an admin is doing here is often fixing exactly this.
 *
 * A working model gets no badge. Marking the ordinary case would leave every
 * list speckled with a word that carries nothing.
 */
const LABEL: Record<ModelStatus, string | null> = {
  available: null,
  disabled: 'Disabled',
  'no-enabled-provider': 'Providers unavailable'
};

/** Switched off here, or switched off underneath. The first is a deliberate
 *  act on this model, the second is usually collateral from the provider page,
 *  so only the second reads as something to look into. */
const TONE: Record<ModelStatus, string> = {
  available: '',
  disabled: 'border-border text-muted-foreground',
  'no-enabled-provider':
    'border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-400'
};

export function ModelStatusBadge({
  status,
  className
}: {
  status: ModelStatus;
  className?: string;
}) {
  const label = LABEL[status];
  if (!label) return null;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[11px] font-medium whitespace-nowrap',
        TONE[status],
        className
      )}
    >
      {label}
    </span>
  );
}
