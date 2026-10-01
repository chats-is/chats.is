import { type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

/**
 * An action on a row, the same in every list: an icon at the right, always
 * there, named by its tooltip — and when it cannot be done, disabled, with
 * why in the tooltip instead.
 */
export function RowAction({
  icon: Icon,
  label,
  onClick,
  disabled
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Why it cannot be done now, when it cannot. */
  disabled?: string | null;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The span keeps the tooltip over a disabled button. */}
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            aria-label={label}
            disabled={!!disabled}
            onClick={onClick}
          >
            <Icon className="size-4" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabled ?? label}</TooltipContent>
    </Tooltip>
  );
}

/** Why a payment cannot be refunded now, or null when it can. */
export function refundBlockedOf(p: {
  status: string;
  leftToRefund: number;
}): string | null {
  if (p.leftToRefund > 0) return null;
  if (p.status === 'refund_pending') {
    return 'A refund is waiting for the payment processor';
  }
  if (p.status === 'failed') return 'The payment failed';
  return 'Nothing left to refund';
}
