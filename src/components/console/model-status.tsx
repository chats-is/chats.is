import { type ReactNode } from 'react';
import { Info } from 'lucide-react';

import { type ModelStatus } from '@/types/model';
import { MODEL_STATUS_LABELS } from '@/lib/constant';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

/**
 * A model's name as the console lists it, saying when it will not answer:
 * struck through — and where it is its providers that are off, which the
 * name does not say, with an amber info mark that does. A working model
 * reads as itself.
 *
 * The console's selectors offer every model, the ones that cannot answer
 * included — a model is chosen here before it is switched on, and a setting
 * already pointing at one that has stopped answering has to keep saying so.
 * The marks say so without barring the choice, because what an admin is
 * doing here is often fixing exactly this.
 */
export function ModelStatusName({
  status,
  children,
  className
}: {
  status: ModelStatus;
  /** The name, as the place shows it: a display name or an id. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <span
        className={cn('truncate', status !== 'available' && 'line-through')}
      >
        {children}
      </span>
      {status === 'no-enabled-provider' && <ProvidersOffMark />}
    </span>
  );
}

/** Switched off underneath, by its providers: an info mark, with why behind
 *  it — where something can take the pointer; on a select's trigger Radix
 *  lets nothing. */
function ProvidersOffMark() {
  const label = MODEL_STATUS_LABELS['no-enabled-provider']!;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label={label} className="inline-flex shrink-0">
          {/* Amber: usually collateral from the provider page, so something
              to look into. On the icon itself, since a select greys every
              icon that names no colour of its own. */}
          <Info className="size-3.5 text-amber-700 dark:text-amber-400" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
