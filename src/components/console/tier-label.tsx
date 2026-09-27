import { describeMultiplier } from '@/lib/billing';
import { Badge } from '@/components/ui/badge';

/** A tier as a choice reads: its name, and its multiplier as a badge. */
export function TierLabel({
  name,
  priceMultiplier
}: {
  name: string;
  priceMultiplier: string | number | null | undefined;
}) {
  return (
    <span className="flex items-center gap-2">
      {name}
      <Badge variant="secondary" className="font-sans">
        {describeMultiplier(priceMultiplier)}
      </Badge>
    </span>
  );
}
