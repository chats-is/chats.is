import { tokensOf } from '@/lib/usage-breakdown';
import { formatNumber } from '@/lib/utils';
import { type adminUsageStats } from '@/server/functions/usage';
import {
  groupTotals,
  mediaText,
  searchItems,
  totalOf
} from '@/components/console/daily-usage-chart';
import { StatCard } from '@/components/console/stat-card';

/**
 * The window's four usage totals, each with a line saying what it is — the
 * same on the Overview, the Usage page and a user's page, each of which
 * lays them out.
 */
export function UsageTotals({
  stats
}: {
  stats: Awaited<ReturnType<typeof adminUsageStats>>;
}) {
  // The window's figures, every capability's added up.
  const whole = totalOf(groupTotals(stats, 'capability'));
  // What searches of X fetched, beside the searches of the web the card
  // counts.
  const fetched = searchItems({ ...whole, webSearches: 0 }).join(' · ');
  return (
    <>
      <StatCard
        title="Tokens"
        value={formatNumber(tokensOf(whole))}
        sub="Read and written by the models"
      />
      <StatCard
        title="Model"
        value={formatNumber(groupTotals(stats, 'model').length)}
        sub="Models called in this period"
      />
      <StatCard
        title="Media"
        // Images, videos and audio calls together, then each, as the
        // Usage page's table counts them.
        value={formatNumber(whole.images + whole.videos + whole.audios)}
        sub={mediaText(whole) || 'None in this period'}
      />
      <StatCard
        title="Search"
        value={formatNumber(whole.webSearches)}
        sub={fetched || 'Searches of the web'}
      />
    </>
  );
}
