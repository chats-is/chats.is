import { CircleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

/**
 * A model with no rate on the dimension it bills on. The case worth the eye:
 * what it bills is recorded and costed at nothing until someone gives it a
 * rate — so the models and the pricing tables mark it the same way.
 */
export function UnpricedBadge() {
  return (
    <Badge
      variant="outline"
      className="border-amber-300 font-sans text-amber-700 dark:border-amber-900 dark:text-amber-400"
    >
      <CircleAlert data-icon="inline-start" />
      Not set
    </Badge>
  );
}
