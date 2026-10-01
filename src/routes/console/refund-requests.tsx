import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { pageSearchSchema } from '@/types/pagination';
import { pageTitle } from '@/lib/head';
import { subscriptionQueries } from '@/server/functions/subscription';
import RefundRequests, {
  RefundRequestsPending
} from '@/components/console/refund-requests';
import { refundRequestTableInput } from '@/components/console/table-filters';

/** Filters live in the address, so a filtered view can be linked. */
const searchSchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  page: pageSearchSchema
});

export const Route = createFileRoute('/console/refund-requests')({
  validateSearch: searchSchema,
  // The first page, under the key the component asks for on a plain visit.
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      subscriptionQueries.refundRequests(refundRequestTableInput({}))
    ),
  head: ({ matches }) => ({
    meta: [{ title: pageTitle(matches, 'Refund requests') }]
  }),
  pendingComponent: RefundRequestsPending,
  component: RefundRequests
});
