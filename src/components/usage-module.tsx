import { useMemo } from 'react'

import type {
  DailyDay,
  DailyGroup,
  UsageKpi,
  UsageRow,
  UserUsageKpi,
  UserUsageRow,
} from '@/types'
import { formatNumber, formatUsd } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Skeleton } from '@/components/ui/skeleton'

/** Chart grouping dimension — local to this component. */
type GroupBy = 'model' | 'provider' | 'capability'

/**
 * Skeleton placeholder for the Limits section (two quota cards), shown while
 * the quota snapshot loads.
 */
export function LimitsSkeleton() {
  return (
    <section className="space-y-3">
      <Skeleton className="h-5 w-16" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="py-0">
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

/**
 * Skeleton placeholder mirroring `UsageModule`'s layout (KPI cards + chart),
 * shown while usage data loads. `isAdmin` adds the cost tile and chart.
 */
export function UsageModuleSkeleton({
  isAdmin = false,
}: {
  isAdmin?: boolean
}) {
  return (
    <div className="space-y-4">
      <div
        className={
          isAdmin ? 'grid gap-4 md:grid-cols-3' : 'grid gap-4 md:grid-cols-2'
        }
      >
        {Array.from({ length: isAdmin ? 3 : 2 }).map((_, i) => (
          <Card key={i} className="py-0">
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-8 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      {isAdmin && (
        <Card className="py-0">
          <CardContent className="space-y-3 p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#a855f7', // purple
  '#ef4444', // red
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#ec4899', // pink
  '#f97316', // orange
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#eab308', // yellow
]

/** Parse a `'YYYY-MM-DD'` string as a *local* Date (midnight in browser TZ). */
const parseLocalDate = (key: string): Date => {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Format a Date as `YYYY-MM-DD` in browser local TZ. This is the SINGLE
 *  source of truth for "what day does this Date belong to" — used by both
 *  bucketByLocalDay() and buildContinuousDays(). */
const toLocalDateKey = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Short day label — `May 05` (used on chart axes). */
const fmtDay = (s: string) => {
  try {
    return parseLocalDate(s).toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
    })
  } catch {
    return s
  }
}

/** Long day label — `May 05, 2026` (used in hover tooltips so the year is
 *  explicit when ranges span across years). */
const fmtDayLong = (s: string) => {
  try {
    return parseLocalDate(s).toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    })
  } catch {
    return s
  }
}

/** Bucket raw usage rows by browser-local calendar day + the chosen group
 *  dimension. This is the ONLY place where "which day does a record fall on"
 *  is decided — it uses `new Date(row.createdAt)` + local-TZ getters, which
 *  is identical to what the Logs table uses to render times, so the chart and
 *  Logs are guaranteed to agree. */
function bucketByLocalDay(
  rows: UsageRow[] | UserUsageRow[],
  groupBy: GroupBy,
): DailyDay[] {
  const byDay = new Map<string, Map<string, DailyGroup>>()
  for (const r of rows) {
    const created =
      r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)
    const dayKey = toLocalDateKey(created)

    let groupKey: string
    let groupLabel: string
    if (groupBy === 'model') {
      groupKey = r.modelId ?? 'unknown'
      groupLabel = r.modelId ?? 'unknown'
    } else if (groupBy === 'provider') {
      groupKey = r.providerId ?? 'unknown'
      groupLabel = r.providerName ?? 'Unknown'
    } else {
      groupKey = r.capability
      groupLabel = r.capability
    }

    if (!byDay.has(dayKey)) byDay.set(dayKey, new Map())
    const dayMap = byDay.get(dayKey)!
    let g = dayMap.get(groupKey)
    if (!g) {
      g = {
        key: groupKey,
        label: groupLabel,
        cost: '0',
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      }
      dayMap.set(groupKey, g)
    }
    // r.cost is admin-only; user rows have no cost field — fall back to 0.
    const rowCost = 'cost' in r && r.cost !== undefined ? Number(r.cost) : 0
    g.cost = (Number(g.cost) + rowCost).toString()
    g.requests += 1
    g.inputTokens += Number(r.inputTokens ?? 0)
    g.outputTokens += Number(r.outputTokens ?? 0)
    g.cacheReadTokens += Number(r.cacheReadTokens ?? 0)
    g.cacheWriteTokens += Number(r.cacheWriteTokens ?? 0)
    g.reasoningTokens += Number(r.reasoningTokens ?? 0)
  }
  return Array.from(byDay.entries()).map(([day, groups]) => ({
    day,
    groups: Array.from(groups.values()),
  }))
}

/** Fill empty days so the chart spans a continuous range. Day keys are
 *  `'YYYY-MM-DD'` strings in the user's local timezone. */
function buildContinuousDays(
  daily: DailyDay[],
  days: number | undefined,
): DailyDay[] {
  const byKey = new Map<string, DailyDay>()
  for (const d of daily) byKey.set(d.day.slice(0, 10), d)

  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  let start: Date
  if (typeof days === 'number' && days > 0) {
    start = new Date(end)
    start.setDate(start.getDate() - (days - 1))
  } else if (daily.length > 0) {
    const earliest = daily.map((d) => d.day).sort((a, b) => (a < b ? -1 : 1))[0]
    start = parseLocalDate(earliest)
  } else {
    start = new Date(end)
    start.setDate(start.getDate() - 6)
  }

  const out: DailyDay[] = []
  const cursor = new Date(start)
  while (cursor.getTime() <= end.getTime()) {
    const key = toLocalDateKey(cursor)
    out.push(byKey.get(key) ?? { day: key, groups: [] })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

type ChartProps = {
  rows: UsageRow[]
  groupBy?: GroupBy
  days?: number
  title?: string
}

/**
 * Daily stacked bar chart with explicit Y-axis (cost ticks) and X-axis (day labels).
 * Each day's bar is composed of segments colored by group key (model / provider / capability).
 */
export function DailyStackedChart({
  rows,
  groupBy = 'model',
  days,
  title,
}: ChartProps) {
  const daily = useMemo(() => bucketByLocalDay(rows, groupBy), [rows, groupBy])

  const continuous = useMemo(
    () => buildContinuousDays(daily, days),
    [daily, days],
  )

  // Color mapping by total cost rank — biggest spender gets stable color.
  const colorMap = useMemo(() => {
    const totals = new Map<string, number>()
    const labels = new Map<string, string>()
    for (const d of daily) {
      for (const g of d.groups) {
        totals.set(g.key, (totals.get(g.key) ?? 0) + Number(g.cost))
        labels.set(g.key, g.label)
      }
    }
    const ordered = Array.from(totals.entries()).sort((a, b) => b[1] - a[1])
    const cm = new Map<string, string>()
    ordered.forEach(([k], idx) => {
      cm.set(k, PALETTE[idx % PALETTE.length])
    })
    return { color: cm, label: labels }
  }, [daily])

  const maxDailyCost = useMemo(() => {
    let max = 0
    for (const d of continuous) {
      const sum = d.groups.reduce((s, g) => s + Number(g.cost), 0)
      if (sum > max) max = sum
    }
    return max
  }, [continuous])

  // 5 Y-axis ticks (top → bottom).
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((f) => maxDailyCost * f)

  return (
    <Card className="py-0">
      <CardContent className="p-4">
        {title && <div className="mb-3 text-base font-medium">{title}</div>}
        {continuous.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No usage in this window.
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              {/* Y-axis */}
              <div className="flex h-40 flex-col justify-between pr-1 text-right text-[10px] text-muted-foreground">
                {yTicks.map((t, i) => (
                  <span
                    key={i}
                    style={{ height: 1 }}
                    className="-mt-1 whitespace-nowrap"
                  >
                    {formatUsd(t)}
                  </span>
                ))}
              </div>

              {/* Chart area */}
              <div className="flex flex-1 flex-col">
                <div className="flex h-40 items-end gap-3 border-b border-l">
                  {continuous.map((d) => {
                    const dayTotal = d.groups.reduce(
                      (s, g) => s + Number(g.cost),
                      0,
                    )
                    const dayPct =
                      maxDailyCost > 0 ? (dayTotal / maxDailyCost) * 100 : 0

                    // Empty days render only the column slot — no bar, no hover.
                    if (dayTotal === 0) {
                      return (
                        <div
                          key={d.day}
                          className="flex flex-1 items-end"
                          style={{ height: '100%' }}
                        />
                      )
                    }

                    return (
                      <div
                        key={d.day}
                        className="flex flex-1 items-end"
                        style={{ height: '100%' }}
                      >
                        <HoverCard openDelay={80} closeDelay={40}>
                          <HoverCardTrigger
                            render={
                              <div
                                className="mx-auto flex w-1/2 max-w-5 cursor-pointer flex-col-reverse overflow-hidden rounded-t transition-[filter] hover:brightness-110"
                                style={{ height: `${dayPct}%` }}
                              >
                                {d.groups
                                  .slice()
                                  .sort(
                                    (a, b) => Number(b.cost) - Number(a.cost),
                                  )
                                  .map((g) => {
                                    const segPct =
                                      (Number(g.cost) / dayTotal) * 100
                                    return (
                                      <div
                                        key={g.key}
                                        style={{
                                          height: `${segPct}%`,
                                          background:
                                            colorMap.color.get(g.key) ??
                                            '#94a3b8',
                                        }}
                                      />
                                    )
                                  })}
                              </div>
                            }
                          />
                          <HoverCardContent
                            side="left"
                            align="center"
                            sideOffset={8}
                            collisionPadding={16}
                            className="w-72 p-3"
                          >
                            <DayTooltipContent
                              day={d}
                              color={colorMap.color}
                              label={colorMap.label}
                            />
                          </HoverCardContent>
                        </HoverCard>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-1 flex gap-3">
                  {continuous.map((d) => (
                    <div
                      key={d.day}
                      className="flex-1 truncate text-center text-[10px] text-muted-foreground"
                    >
                      {fmtDay(d.day)}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Legend */}
            {colorMap.color.size > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {Array.from(colorMap.color.entries()).map(([k, color]) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1.5 rounded border bg-muted/30 px-2 py-0.5 font-mono"
                  >
                    <span
                      className="inline-block size-2.5 rounded-sm"
                      style={{ background: color }}
                    />
                    {colorMap.label.get(k) ?? k}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function DayTooltipContent({
  day,
  color,
  label,
}: {
  day: DailyDay
  color: Map<string, string>
  label: Map<string, string>
}) {
  const dayTotal = day.groups.reduce((s, g) => s + Number(g.cost), 0)
  // Match the visual bar order: bar uses flex-col-reverse + cost-desc, so the
  // smallest segment sits on top. Tooltip reads top→bottom = small→large.
  const sorted = day.groups
    .slice()
    .sort((a, b) => Number(a.cost) - Number(b.cost))
  return (
    <>
      <div className="flex items-center justify-between border-b pb-1.5 text-sm font-medium">
        <span>{fmtDayLong(day.day)}</span>
        <span className="font-mono">{formatUsd(dayTotal)}</span>
      </div>
      {sorted.length === 0 ? (
        <div className="pt-2 text-xs text-muted-foreground">No usage</div>
      ) : (
        <div className="space-y-2 pt-2">
          {sorted.map((g) => (
            <div key={g.key} className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ background: color.get(g.key) ?? '#94a3b8' }}
                />
                <span className="truncate font-mono font-medium">
                  {label.get(g.key) ?? g.key}
                </span>
                <span className="ml-auto font-mono">{formatUsd(g.cost)}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-4 text-[11px]">
                <dt className="text-muted-foreground">Requests</dt>
                <dd className="text-right font-mono">
                  {formatNumber(g.requests)}
                </dd>
                <dt className="text-muted-foreground">Input tokens</dt>
                <dd className="text-right font-mono">
                  {formatNumber(g.inputTokens)}
                </dd>
                <dt className="text-muted-foreground">Output tokens</dt>
                <dd className="text-right font-mono">
                  {formatNumber(g.outputTokens)}
                </dd>
                <dt className="text-muted-foreground">Reasoning tokens</dt>
                <dd className="text-right font-mono">
                  {formatNumber(g.reasoningTokens)}
                </dd>
                <dt className="text-muted-foreground">Cache read tokens</dt>
                <dd className="text-right font-mono">
                  {formatNumber(g.cacheReadTokens)}
                </dd>
                <dt className="text-muted-foreground">Cache write tokens</dt>
                <dd className="text-right font-mono">
                  {formatNumber(g.cacheWriteTokens)}
                </dd>
              </dl>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

type Props = {
  /** Admin shape carries `totalCost`; user shape doesn't. */
  kpi: UsageKpi | UserUsageKpi
  /** Admin rows carry `cost`; user rows don't. */
  rows: UsageRow[] | UserUsageRow[]
  days?: number
  chartTitle?: string
}

/** KPI tiles + (admin only) the by-model daily cost chart.
 *  Auto-detects mode from the presence of `totalCost` in `kpi`. */
export function UsageModule({
  kpi,
  rows,
  days,
  chartTitle = 'Daily cost',
}: Props) {
  // User mode strips all cost-related UI. Detected by absence of totalCost.
  const isAdmin = 'totalCost' in kpi
  // "Total tokens" = input + output. Providers count cache read as a subset
  // of input, so adding cache R/W would double-count. Cache figures stay in
  // the hover breakdown for transparency.
  const tokensTotal = kpi.inputTokens + kpi.outputTokens

  // Daily series for each KPI sparkline. Reuses the same bucketing as the
  // logs table so chart and table agree on which row falls on which day.
  const series = useMemo(() => {
    const daily = buildContinuousDays(bucketByLocalDay(rows, 'model'), days)
    return daily.map((d) => {
      const cost = d.groups.reduce((sum, g) => sum + Number(g.cost ?? 0), 0)
      const requests = d.groups.reduce((sum, g) => sum + g.requests, 0)
      const inputTokens = d.groups.reduce((sum, g) => sum + g.inputTokens, 0)
      const outputTokens = d.groups.reduce((sum, g) => sum + g.outputTokens, 0)
      const cacheReadTokens = d.groups.reduce(
        (sum, g) => sum + g.cacheReadTokens,
        0,
      )
      const cacheWriteTokens = d.groups.reduce(
        (sum, g) => sum + g.cacheWriteTokens,
        0,
      )
      const reasoningTokens = d.groups.reduce(
        (sum, g) => sum + g.reasoningTokens,
        0,
      )
      return {
        day: d.day,
        cost,
        requests,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        reasoningTokens,
        // Total = input + output (cache R already counted inside input)
        tokensTotal: inputTokens + outputTokens,
      }
    })
  }, [rows, days])

  return (
    <div className="space-y-4">
      <div
        className={
          isAdmin ? 'grid gap-4 md:grid-cols-3' : 'grid gap-4 md:grid-cols-2'
        }
      >
        {isAdmin && (
          <Card className="py-0">
            <CardContent className="p-4">
              <div className="text-sm font-medium text-muted-foreground">
                Cost
              </div>
              <div className="text-2xl font-bold">
                {formatUsd((kpi as UsageKpi).totalCost)}
              </div>
              <Sparkline
                color="#3b82f6"
                points={series.map((s) => ({
                  day: s.day,
                  value: s.cost,
                  tooltip: (
                    <SparkTooltip
                      day={s.day}
                      items={[{ label: 'Cost', value: formatUsd(s.cost) }]}
                    />
                  ),
                }))}
              />
            </CardContent>
          </Card>
        )}
        <Card className="py-0">
          <CardContent className="p-4">
            <div className="text-sm font-medium text-muted-foreground">
              Tokens
            </div>
            <HoverCard openDelay={50} closeDelay={50}>
              <HoverCardTrigger
                render={
                  <div className="inline-block cursor-default text-2xl font-bold">
                    {formatNumber(tokensTotal)}
                  </div>
                }
              />
              <HoverCardContent
                side="bottom"
                align="start"
                className="w-auto min-w-36 p-3"
              >
                <div className="text-sm font-medium">Tokens breakdown</div>
                <div className="my-2 border-t" />
                <MetricsList
                  items={[
                    {
                      label: 'Input tokens',
                      value: formatNumber(kpi.inputTokens),
                    },
                    {
                      label: 'Output tokens',
                      value: formatNumber(kpi.outputTokens),
                    },
                    {
                      label: 'Reasoning tokens',
                      value: formatNumber(kpi.reasoningTokens),
                    },
                    {
                      label: 'Cache read tokens',
                      value: formatNumber(kpi.cacheReadTokens),
                    },
                    {
                      label: 'Cache write tokens',
                      value: formatNumber(kpi.cacheWriteTokens),
                    },
                  ]}
                />
              </HoverCardContent>
            </HoverCard>
            <Sparkline
              color="#a855f7"
              points={series.map((s) => ({
                day: s.day,
                value: s.tokensTotal,
                tooltip: (
                  <SparkTooltip
                    day={s.day}
                    items={[
                      {
                        label: 'Input tokens',
                        value: formatNumber(s.inputTokens),
                      },
                      {
                        label: 'Output tokens',
                        value: formatNumber(s.outputTokens),
                      },
                      {
                        label: 'Reasoning tokens',
                        value: formatNumber(s.reasoningTokens),
                      },
                      {
                        label: 'Cache read tokens',
                        value: formatNumber(s.cacheReadTokens),
                      },
                      {
                        label: 'Cache write tokens',
                        value: formatNumber(s.cacheWriteTokens),
                      },
                    ]}
                  />
                ),
              }))}
            />
          </CardContent>
        </Card>
        <Card className="py-0">
          <CardContent className="p-4">
            <div className="text-sm font-medium text-muted-foreground">
              Requests
            </div>
            <div className="text-2xl font-bold">
              {formatNumber(kpi.requests)}
            </div>
            <Sparkline
              color="#10b981"
              points={series.map((s) => ({
                day: s.day,
                value: s.requests,
                tooltip: (
                  <SparkTooltip
                    day={s.day}
                    items={[
                      { label: 'Requests', value: formatNumber(s.requests) },
                    ]}
                  />
                ),
              }))}
            />
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
        <DailyStackedChart
          rows={rows as UsageRow[]}
          groupBy="model"
          days={days}
          title={chartTitle}
        />
      )}
    </div>
  )
}

type SparkPoint = {
  day: string
  value: number
  tooltip: React.ReactNode
}

/**
 * Small smooth line chart for a KPI tile. Each day is rendered as a dot on
 * a smoothed (Catmull-Rom-to-Bezier) curve. Hover a dot to see the per-day
 * tooltip rendered by the parent.
 */
function Sparkline({ points, color }: { points: SparkPoint[]; color: string }) {
  const W = 200
  const H = 48
  const PAD = 6

  if (points.length === 0) {
    return <div className="h-12" />
  }

  const max = Math.max(...points.map((p) => p.value), 1)
  const range = max || 1

  const xAt = (i: number) =>
    points.length === 1
      ? W / 2
      : PAD + (i * (W - 2 * PAD)) / (points.length - 1)
  const yAt = (v: number) => H - PAD - (v / range) * (H - 2 * PAD)

  const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }))
  const path = smoothPath(coords)
  const areaPath = `${path} L ${coords[coords.length - 1].x} ${H} L ${coords[0].x} ${H} Z`
  const gradId = `spark-grad-${color.replace('#', '')}`

  return (
    <div className="relative mt-2 h-12">
      {/* SVG covers the box; preserveAspectRatio=none lets the curve stretch */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Each dot is wrapped in a HoverCard — same interaction primitive as
          the Tokens big-number tooltip for consistency. */}
      {coords.map((c, i) => {
        const left = `${(c.x / W) * 100}%`
        const top = `${(c.y / H) * 100}%`
        return (
          <HoverCard key={i} openDelay={50} closeDelay={50}>
            <HoverCardTrigger
              render={
                <div
                  className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer p-1.5"
                  style={{ left, top }}
                >
                  <div
                    className="size-1.5 rounded-full ring-1 ring-background transition-all hover:size-2"
                    style={{ backgroundColor: color }}
                  />
                </div>
              }
            />
            <HoverCardContent
              side="left"
              align="center"
              className="w-auto min-w-36 p-3"
            >
              {points[i].tooltip}
            </HoverCardContent>
          </HoverCard>
        )
      })}
    </div>
  )
}

/** Single-line metric rows: label left (muted), value right (mono).
 *  Each row stays on one line — no wrapping inside a metric. */
function MetricsList({
  items,
}: {
  items: Array<{ label: string; value: string }>
}) {
  return (
    <div className="space-y-1 text-sm">
      {items.map((i) => (
        <div
          key={i.label}
          className="flex items-baseline justify-between gap-6 whitespace-nowrap"
        >
          <span className="text-muted-foreground">{i.label}</span>
          <span className="font-mono">{i.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Sparkline tooltip: date header → divider → metrics list. */
function SparkTooltip({
  day,
  items,
}: {
  day: string
  items: Array<{ label: string; value: string }>
}) {
  return (
    <div className="min-w-36">
      <div className="text-sm font-medium">{fmtDayLong(day)}</div>
      <div className="my-2 border-t" />
      <MetricsList items={items} />
    </div>
  )
}

/** Catmull-Rom-to-Bezier smoothing. Produces a single SVG path. */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}
