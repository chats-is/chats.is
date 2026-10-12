import { paginationSchema } from './pagination';
import { usageRangeSchema } from './usage';

/** One page of the users the business lost money on over a window. */
export const revenueLossUsersSchema = usageRangeSchema.extend(
  paginationSchema.shape
);
