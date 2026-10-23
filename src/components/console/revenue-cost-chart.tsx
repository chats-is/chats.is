import { format } from 'date-fns';

import { AMOUNT_COLORS } from '@/lib/constant';
import { formatUsd } from '@/lib/utils';
import { Amount } from '@/components/console/amount';
import { DailyLineChart } from '@/components/console/daily-line-chart';

/** Each day's revenue against what its calls cost, with the profit left —
 *  or each hour's, over a window of one day. */
export function RevenueCostChart({
  days,
  hourly = false
}: {
  days: Array<{ start: Date; revenue: number; cost: number }>;
  hourly?: boolean;
}) {
  const rows = days.map(d => ({
    key: format(d.start, 'yyyy-MM-dd'),
    date: d.start,
    values: [d.revenue, d.cost],
    items: [
      {
        label: 'Revenue',
        color: AMOUNT_COLORS.revenue.bar,
        value: <Amount kind="revenue" value={d.revenue} />
      },
      {
        label: 'Cost',
        color: AMOUNT_COLORS.cost.bar,
        value: <Amount kind="cost" value={d.cost} />
      },
      {
        label: 'Profit',
        value: <Amount kind="profit" value={d.revenue - d.cost} />
      }
    ]
  }));
  return (
    <DailyLineChart
      title={hourly ? 'Hourly revenue and cost' : 'Daily revenue and cost'}
      series={[
        { label: 'Revenue', color: AMOUNT_COLORS.revenue.bar },
        { label: 'Cost', color: AMOUNT_COLORS.cost.bar }
      ]}
      rows={rows}
      // Revenue and cost on one axis, read as the model's money is.
      formatTick={formatUsd}
      empty="No revenue or cost in this period."
      hourly={hourly}
    />
  );
}
