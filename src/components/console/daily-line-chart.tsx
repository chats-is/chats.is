import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  formatDate,
  formatDateHour,
  formatHour,
  formatShortDate
} from '@/lib/format-date';
import { Card, CardContent } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
} from '@/components/ui/chart';

type Series = { label: string; color: string };

type DayPair = {
  key: string;
  date: Date;
  /** A figure for each series, in its order. */
  values: number[];
  /** The day's figures, as its tooltip lists them. */
  items: Array<{ label: string; color?: string; value: React.ReactNode }>;
};

/** The series' keys in the chart's data, in their order. */
const KEYS = ['first', 'second'] as const;

/**
 * Two figures a day as two curves, drawn with shadcn/ui's chart over
 * recharts; pointing at a day lists its figures.
 */
export function DailyLineChart({
  title,
  series,
  rows,
  formatTick,
  empty,
  whole = false,
  hourly = false
}: {
  title: string;
  series: [Series, Series];
  rows: DayPair[];
  formatTick: (v: number) => string;
  empty: string;
  /** Figures that are counts, so every tick is a whole number. */
  whole?: boolean;
  /** Each row an hour of one day rather than a day. */
  hourly?: boolean;
}) {
  // Each area's gradient by an id of this chart's own, as a page shows
  // several; useId's punctuation is not an SVG id's.
  const fillId = `fill-${useId().replace(/[^\w-]/g, '')}`;
  const config = {
    first: series[0],
    second: series[1]
  } satisfies ChartConfig;
  const data = rows.map(r => ({
    ...r,
    day: hourly ? formatHour(r.date) : formatShortDate(r.date),
    first: r.values[0],
    second: r.values[1]
  }));
  type Day = (typeof data)[number];
  const peak = Math.max(0, ...rows.flatMap(r => r.values));

  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <div className="mb-3 text-base font-medium">{title}</div>
        {peak === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {empty}
          </div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-52 w-full">
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                minTickGap={16}
              />
              <YAxis
                width="auto"
                tickLine={false}
                axisLine={false}
                allowDecimals={!whole}
                tickFormatter={v => formatTick(Number(v))}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      (hourly ? formatDateHour : formatDate)(
                        (payload[0]?.payload as Day).date
                      )
                    }
                    // Each curve's own line, and under the last, what else
                    // the day adds up to.
                    formatter={(_value, _name, curve, index) => (
                      <div className="grid basis-full gap-1.5">
                        {(index === KEYS.length - 1
                          ? (curve.payload as Day).items.slice(index)
                          : [(curve.payload as Day).items[index]]
                        ).map(item => (
                          <div
                            key={item.label}
                            className="flex items-center gap-2"
                          >
                            <div
                              className="size-2.5 shrink-0 rounded-[2px]"
                              style={{
                                background: item.color ?? 'transparent'
                              }}
                            />
                            <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                              <span className="text-muted-foreground">
                                {item.label}
                              </span>
                              <span className="font-mono font-medium text-foreground tabular-nums">
                                {item.value}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  />
                }
              />
              {/* Fading toward the axis, as shadcn/ui's area charts do. */}
              <defs>
                {KEYS.map(key => (
                  <linearGradient
                    key={key}
                    id={`${fillId}-${key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={`var(--color-${key})`}
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="95%"
                      stopColor={`var(--color-${key})`}
                      stopOpacity={0.1}
                    />
                  </linearGradient>
                ))}
              </defs>
              {KEYS.map(key => (
                <Area
                  key={key}
                  dataKey={key}
                  type="monotone"
                  stroke={`var(--color-${key})`}
                  fill={`url(#${fillId}-${key})`}
                  strokeWidth={1.5}
                />
              ))}
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
