import { format } from 'date-fns';

/**
 * Every date and time the app shows, in one form.
 *
 * The app speaks English, so its dates do too, whatever language the
 * browser is set to, in the reader's own time zone. How much of a date is
 * shown follows what it is:
 *
 * - a moment something happened — a payment, a refund, a subscription
 *   starting or ending, an account made — to the second:
 *   `Sep 29, 2026 14:05:32`;
 * - a day a bill falls on — a renewal, the end of a period — to the day:
 *   `Sep 29, 2026`;
 * - a day on a chart's axis, where the year goes without saying: `Sep 29`.
 *
 * An instant is shown through `<LocalTime>`, not these directly: the server
 * renders in its own time zone, and only the browser knows the reader's.
 * Dates written for a machine — a range in the address — are not these;
 * they stay `yyyy-MM-dd`.
 */

type DateLike = Date | string | number;

/** A moment, to the second: `Sep 29, 2026 14:05:32`. */
export const formatMoment = (value: DateLike) =>
  format(new Date(value), 'MMM d, yyyy HH:mm:ss');

/** A day: `Sep 29, 2026`. */
export const formatDate = (value: DateLike) =>
  format(new Date(value), 'MMM d, yyyy');

/** A day where the year goes without saying, as on a chart's axis:
 *  `Sep 29`. */
export const formatShortDate = (value: DateLike) =>
  format(new Date(value), 'MMM d');
