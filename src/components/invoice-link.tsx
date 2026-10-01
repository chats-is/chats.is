import { useState } from 'react';
import { Loader2, SquareText } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';

/**
 * A payment's invoice, an icon among a row's actions: the link the
 * processor keeps, or — for a processor whose links do not last — one
 * fetched on the click. The tab opens first, while the click still counts
 * as one, so it is not taken for a pop-up. Disabled, saying why, when the
 * payment has none.
 */
export function InvoiceLink({
  url,
  onDemand,
  open
}: {
  url: string | null;
  onDemand: boolean;
  /** Fetches the link for an invoice made when asked. */
  open: () => Promise<{ url: string }>;
}) {
  const [pending, setPending] = useState(false);
  const fetchAndOpen = async () => {
    const tab = window.open('', '_blank');
    setPending(true);
    try {
      const { url: made } = await open();
      if (tab) tab.location.href = made;
      else window.open(made, '_blank', 'noreferrer');
    } catch (e) {
      tab?.close();
      toast.error(e instanceof Error ? e.message : 'No invoice.');
    } finally {
      setPending(false);
    }
  };
  const icon = pending ? (
    <Loader2 className="size-4 animate-spin" />
  ) : (
    <SquareText className="size-4" />
  );
  const none = !url && !onDemand;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The span keeps the tooltip over a disabled button. */}
        <span className="inline-flex">
          {url ? (
            <Button variant="ghost" size="sm" aria-label="Invoice" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                {icon}
              </a>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Invoice"
              disabled={none || pending}
              onClick={fetchAndOpen}
            >
              {icon}
            </Button>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{none ? 'No invoice' : 'Invoice'}</TooltipContent>
    </Tooltip>
  );
}
