import { useId, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis
} from 'recharts';

import { type ModelCapability, type ProviderType } from '@/types';
import { CAPABILITIES, USAGE_GROUPINGS } from '@/lib/constant';
import {
  formatDate,
  formatDateHour,
  formatHour,
  formatShortDate
} from '@/lib/format-date';
import { tokensOf } from '@/lib/usage-breakdown';
import { formatCount, formatNumber, formatUsd } from '@/lib/utils';
import { type adminUsageStats } from '@/server/functions/usage';
import { Card, CardContent } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Amount } from '@/components/console/amount';

type UsageStats = Awaited<ReturnType<typeof adminUsageStats>>;

/** What a group's calls add up to, on a day or over the window. */
const FIGURES = [
  'spend',
  'cost',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'images',
  'videos',
  'audios'
] as const;
type Figures = Record<(typeof FIGURES)[number], number>;

const NONE = Object.fromEntries(FIGURES.map(f => [f, 0])) as Figures;
const add = (a: Figures, b: Figures) =>
  Object.fromEntries(FIGURES.map(f => [f, a[f] + b[f]])) as Figures;

type Grouping = (typeof USAGE_GROUPINGS)[number]['id'];

/** The most groups the chart draws apart; the rest are drawn as one, in
 *  this grey. */
const MAX_GROUPS = 8;
const OTHER_COLOR = '#94a3b8';

/** The day's money, as two lines over the areas on an axis of its own, in
 *  two greys — Spend the stronger in either theme, and neither the grey of
 *  `OTHER_COLOR`. */
const LINES = [
  {
    key: 'cost',
    label: 'Cost',
    dash: 'dotted',
    theme: { light: 'oklch(0.6 0.04 257)', dark: '#64748b' }
  },
  {
    key: 'spend',
    label: 'Spend',
    dash: 'dashed',
    theme: { light: '#475569', dark: '#cbd5e1' }
  }
] as const;

/**
 * A line's mark in place of a square, and as wide as the squares beside it:
 * a short stroke in its colour, dotted or dashed as it is drawn — three dots
 * or two dashes at any size. Drawn as shapes, since a border that short
 * shows no gaps, and wrapped, as the legend takes an icon's own svg for
 * 12px of grey.
 */
function LineMark({
  line,
  size
}: {
  line: (typeof LINES)[number];
  size: number;
}) {
  const color = `var(--color-${line.key})`;
  const mid = size / 2;
  return (
    <span className="flex shrink-0">
      <svg width={size} height={size} aria-hidden>
        {line.dash === 'dotted'
          ? [1, mid, size - 1].map(x => (
              <circle key={x} cx={x} cy={mid} r={1} fill={color} />
            ))
          : [0, mid + 1].map(x => (
              <rect
                key={x}
                x={x}
                y={mid - 1}
                width={mid - 1}
                height={2}
                fill={color}
              />
            ))}
      </svg>
    </span>
  );
}

/** Each line's mark in the legend, as wide as its squares. */
const LINE_MARKS = Object.fromEntries(
  LINES.map(l => [
    l.key,
    function LegendLineMark() {
      return <LineMark line={l} size={8} />;
    }
  ])
);

/**
 * Who makes a model, told from its name, and the colour every model of
 * theirs wears, as an OKLCH chroma and hue.
 */
const MAKERS = [
  { maker: 'claude', name: /^claude/, color: [0.14, 46] }, // clay
  { maker: 'gemini', name: /^(gemini|gemma|imagen|veo)/, color: [0.18, 260] }, // blue
  {
    maker: 'openai',
    name: /^(gpt|o\d|chatgpt|sora|dall-e|whisper|tts|codex)/,
    color: [0.12, 170] // teal
  },
  {
    maker: 'mistral',
    name: /^(mistral|mixtral|codestral|magistral|ministral|pixtral|devstral)/,
    color: [0.13, 73] // gold
  },
  { maker: 'deepseek', name: /^deepseek/, color: [0.25, 293] }, // violet
  { maker: 'qwen', name: /^(qwen|qwq|qvq)/, color: [0.23, 324] }, // magenta
  { maker: 'grok', name: /^grok/, color: [0.2, 17] }, // crimson
  { maker: 'glm', name: /^(glm|chatglm|codegeex)/, color: [0.2, 277] }, // indigo
  { maker: 'minimax', name: /^(minimax|abab)/, color: [0.2, 355] } // rose
] as const;
type Maker = (typeof MAKERS)[number]['maker'];

/** The colour of a model whose maker its name does not tell, and of a
 *  provider that sells many makers' models: cyan. */
const UNPLACED = [0.11, 222] as const;

/** The maker whose colour a provider of each type wears: the one whose
 *  models it sells, or none for Bedrock, which sells many makers'. */
const PROVIDER_MAKERS: Record<ProviderType, Maker | null> = {
  openai: 'openai',
  azure: 'openai',
  google: 'gemini',
  vertex: 'gemini',
  anthropic: 'claude',
  bedrock: null,
  xai: 'grok',
  deepseek: 'deepseek'
};

/** The lightness of a maker's first model, its second and so on, each far
 *  from the one before; past the eighth, a maker's models share the last. */
const SHADES = [0.6, 0.83, 0.45, 0.75, 0.53, 0.9, 0.68, 0.38];

/** There are only four capabilities, so each keeps a colour of its own. */
const CAPABILITY_COLORS: Record<ModelCapability, string> = {
  chat: '#3b82f6', // blue
  image: '#10b981', // emerald
  video: '#f59e0b', // amber
  audio: '#ec4899' // pink
};

/** Who makes a model, told from its name; null when the name does not tell. */
function makerOf(modelId: string): Maker | null {
  // A gateway's `vendor/` before the name is not part of it.
  const name = modelId.toLowerCase().replace(/^[a-z0-9._-]+\//, '');
  return MAKERS.find(m => m.name.test(name))?.maker ?? null;
}

/**
 * The colour of each model or provider: its maker's, in the shade of its
 * place among that maker's in the order the install added them — so it
 * keeps it whatever the window or its rank. Ones the rows name
 * that the install no longer has come after them, in the order of their key.
 */
function colorsOf(
  stats: UsageStats,
  grouping: 'model' | 'provider',
  keys: Array<string | null>
) {
  const placed: Array<{ key: string | null; maker: Maker | null }> =
    grouping === 'model'
      ? stats.catalog.models.map(id => ({ key: id, maker: makerOf(id) }))
      : stats.catalog.providers.map(p => ({
          key: p.id,
          maker: PROVIDER_MAKERS[p.type]
        }));
  const known = new Set(placed.map(p => p.key));
  for (const key of keys
    .filter(k => !known.has(k))
    .sort((a, b) => (a ?? '').localeCompare(b ?? ''))) {
    placed.push({
      key,
      maker: grouping === 'model' && key !== null ? makerOf(key) : null
    });
  }

  const seen = new Map<Maker | null, number>();
  const colors = new Map<string | null, string>();
  for (const { key, maker } of placed) {
    const n = seen.get(maker) ?? 0;
    seen.set(maker, n + 1);
    const [chroma, hue] = maker
      ? MAKERS.find(m => m.maker === maker)!.color
      : UNPLACED;
    const lightness = SHADES[Math.min(n, SHADES.length - 1)];
    // Less chroma the further from the first shade, so the palest and the
    // darkest stay colours a screen can show.
    const c = chroma * (1 - 1.4 * Math.abs(lightness - SHADES[0]));
    colors.set(key, `oklch(${lightness} ${c.toFixed(3)} ${hue})`);
  }
  return colors;
}

/** Each day's figures for every group of a grouping, the day from 1. */
const rowsOf = (
  stats: UsageStats,
  grouping: Grouping
): Array<Figures & { day: number; key: string | null }> =>
  grouping === 'model'
    ? stats.models
    : grouping === 'provider'
      ? stats.providers
      : stats.capabilities;

/**
 * Each group's figures over the window, the most spent on first, each with
 * the colour it keeps in the chart and the table.
 */
export function groupTotals(stats: UsageStats, grouping: Grouping) {
  const rows = rowsOf(stats, grouping);
  const names = new Map(stats.providers.map(r => [r.key, r.name]));
  const totals = new Map<string | null, Figures>();
  for (const r of rows) totals.set(r.key, add(totals.get(r.key) ?? NONE, r));
  const colors =
    grouping === 'capability'
      ? null
      : colorsOf(stats, grouping, [...totals.keys()]);
  return [...totals]
    .sort(([, a], [, b]) => b.spend - a.spend)
    .map(([key, figures]) => ({
      key,
      label:
        grouping === 'capability'
          ? (CAPABILITIES.find(c => c.value === key)?.label ?? key ?? 'Unknown')
          : grouping === 'provider'
            ? (names.get(key) ?? 'Unknown')
            : (key ?? 'Unknown'),
      color:
        (colors
          ? colors.get(key)
          : CAPABILITY_COLORS[key as ModelCapability]) ?? OTHER_COLOR,
      figures
    }));
}

/** What groups add up to together. */
export function totalOf(groups: Array<{ figures: Figures }>) {
  return groups.reduce((n, g) => add(n, g.figures), NONE);
}

/** What calls made besides tokens, each as how many: images, videos and
 *  audio calls — as the cards, the table and the chart all say it. */
export function mediaText(f: Figures) {
  return [
    f.images > 0 && formatCount(f.images, 'image'),
    f.videos > 0 && formatCount(f.videos, 'video'),
    f.audios > 0 && `${formatNumber(f.audios)} audio`
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Each day of the window in one chart: its tokens as areas laid one on
 * another by model, provider or capability — the biggest groups apart, the
 * rest as one — read on the left, and what users spent and what it cost as
 * two lines, read in dollars on the right. Pointing at a day gives its date
 * and its totals; what each group used is in the table under the chart on
 * the Usage page and a user's page.
 */
export function DailyUsageChart({
  stats,
  dates,
  hourly = false,
  grouping: given,
  onGroupingChange
}: {
  stats: UsageStats;
  /** Each day of the window, as the page's own calendar has it — or each
   *  hour of its one day. */
  dates: Date[];
  /** Each of `dates` an hour of one day rather than a day. */
  hourly?: boolean;
  /** The grouping, when the page keeps it for what follows the chart;
   *  without it the chart keeps its own. */
  grouping?: Grouping;
  onGroupingChange?: (grouping: Grouping) => void;
}) {
  // Each area's gradient by an id of this chart's own; useId's punctuation
  // is not an SVG id's.
  const fillId = `fill-${useId().replace(/[^\w-]/g, '')}`;
  const [own, setOwn] = useState<Grouping>('model');
  const grouping = given ?? own;
  const choose = (next: Grouping) => {
    setOwn(next);
    onGroupingChange?.(next);
  };
  const ranked = groupTotals(stats, grouping)
    .filter(g => tokensOf(g.figures) > 0)
    .sort((a, b) => tokensOf(b.figures) - tokensOf(a.figures));
  const drawn = ranked.slice(0, MAX_GROUPS);
  const rest = ranked.slice(MAX_GROUPS);
  const series = drawn.map((g, i) => ({
    id: `s${i}`,
    label: g.label,
    color: g.color
  }));
  if (rest.length > 0) {
    series.push({ id: 'other', label: 'Other', color: OTHER_COLOR });
  }
  const idOf = new Map(drawn.map((g, i) => [g.key, `s${i}`]));

  const dayOn = new Map(stats.days.map(d => [d.day, d]));
  const rows = rowsOf(stats, grouping);
  const data = dates.map((date, i) => {
    const figures = dayOn.get(i + 1) ?? NONE;
    const values: Record<string, number> = {};
    for (const r of rows) {
      if (r.day !== i + 1 || tokensOf(r) <= 0) continue;
      const id = idOf.get(r.key) ?? 'other';
      values[id] = (values[id] ?? 0) + tokensOf(r);
    }
    return {
      date,
      label: hourly ? formatHour(date) : formatShortDate(date),
      values,
      figures,
      spend: figures.spend,
      cost: figures.cost
    };
  });
  type Day = (typeof data)[number];
  /** A row of the tooltip: a group's square, a line's mark, or neither. */
  type TipRow = {
    label: string;
    value: React.ReactNode;
    color?: string;
    line?: (typeof LINES)[number];
  };
  const whole = (v: number) => formatNumber(Math.round(v));

  return (
    <Card className="py-0">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-base font-medium">
            {hourly ? 'Hourly usage' : 'Daily usage'}
          </div>
          {/* A pill, as the plans dialog's interval switch is. */}
          <Tabs value={grouping} onValueChange={v => choose(v as Grouping)}>
            <TabsList
              aria-label="Group by"
              className="rounded-full border bg-muted/50 p-0.5 group-data-[orientation=horizontal]/tabs:h-8"
            >
              {USAGE_GROUPINGS.map(g => (
                <TabsTrigger
                  key={g.id}
                  value={g.id}
                  className="rounded-full px-3"
                >
                  {g.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {stats.days.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No usage in this period.
          </div>
        ) : (
          <>
            <ChartContainer
              config={Object.fromEntries([
                ...series.map(s => [s.id, { label: s.label, color: s.color }]),
                ...LINES.map(l => [
                  l.key,
                  { label: l.label, theme: l.theme, icon: LINE_MARKS[l.key] }
                ])
              ])}
              className="aspect-auto h-64 w-full"
            >
              <ComposedChart data={data} margin={{ top: 4, right: 0, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                />
                <YAxis
                  yAxisId="count"
                  width="auto"
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  tickFormatter={v => whole(Number(v))}
                />
                <YAxis
                  yAxisId="money"
                  orientation="right"
                  width="auto"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => formatUsd(Number(v))}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) =>
                        (hourly ? formatDateHour : formatDate)(
                          (payload[0]?.payload as Day).date
                        )
                      }
                      // Only the two lines come to the tooltip — the areas
                      // stay out of it — and above the first, what the day's
                      // calls used: each group the chart draws that used any,
                      // in the legend's order and with its mark, then the
                      // whole. Each row is laid out as the other daily
                      // chart's are, a row with no mark keeping its room.
                      formatter={(value, _name, item, index) => {
                        const { figures, values } = item.payload as Day;
                        const media = mediaText(figures);
                        const line = LINES.find(l => l.key === item.dataKey);
                        return (
                          <div className="grid basis-full gap-1.5">
                            {[
                              ...(index === 0
                                ? [
                                    ...series
                                      .filter(s => (values[s.id] ?? 0) > 0)
                                      .map(s => ({
                                        label: s.label,
                                        color: s.color,
                                        value: whole(values[s.id])
                                      })),
                                    {
                                      label: 'Tokens',
                                      value: whole(tokensOf(figures))
                                    },
                                    ...(media
                                      ? [
                                          {
                                            label: 'Media',
                                            value: media
                                          }
                                        ]
                                      : [])
                                  ]
                                : []),
                              {
                                label: line?.label ?? '',
                                line,
                                value:
                                  line?.key === 'cost' ? (
                                    <Amount kind="cost" value={Number(value)} />
                                  ) : (
                                    formatUsd(Number(value))
                                  )
                              }
                            ].map((row: TipRow) => (
                              <div
                                key={row.label}
                                className="flex items-center gap-2"
                              >
                                {row.line ? (
                                  <LineMark line={row.line} size={10} />
                                ) : (
                                  <div
                                    className="size-2.5 shrink-0 rounded-[2px]"
                                    style={{
                                      background: row.color ?? 'transparent'
                                    }}
                                  />
                                )}
                                <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                                  <span className="text-muted-foreground">
                                    {row.label}
                                  </span>
                                  <span className="font-mono font-medium text-foreground tabular-nums">
                                    {row.value}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                  }
                />
                {/* Fading toward the axis, as shadcn/ui's area charts do. */}
                <defs>
                  {series.map(s => (
                    <linearGradient
                      key={s.id}
                      id={`${fillId}-${s.id}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor={s.color} stopOpacity={0.8} />
                      <stop
                        offset="95%"
                        stopColor={s.color}
                        stopOpacity={0.1}
                      />
                    </linearGradient>
                  ))}
                </defs>
                {series.map(s => (
                  <Area
                    key={s.id}
                    yAxisId="count"
                    dataKey={(d: (typeof data)[number]) => d.values[s.id] ?? 0}
                    name={s.id}
                    type="monotone"
                    stackId="day"
                    tooltipType="none"
                    stroke={s.color}
                    fill={`url(#${fillId}-${s.id})`}
                    strokeWidth={1}
                  />
                ))}
                {LINES.map(l => (
                  <Line
                    key={l.key}
                    yAxisId="money"
                    dataKey={l.key}
                    name={l.key}
                    type="monotone"
                    stroke={`var(--color-${l.key})`}
                    strokeWidth={1.5}
                    strokeDasharray={l.dash === 'dotted' ? '1 3' : '4 3'}
                    strokeLinecap={l.dash === 'dotted' ? 'round' : undefined}
                    dot={false}
                  />
                ))}
                {/* Named by the series' `name`, since an area's dataKey is
                    a function. The groups in their order and the two lines
                    last, at the right — put so by name, as recharts would
                    otherwise list them as they mounted, and a switch of
                    grouping mounts its new areas after the lines. */}
                <ChartLegend
                  itemSorter={item =>
                    [
                      ...series.map(s => s.id),
                      ...LINES.map(l => l.key)
                    ].indexOf(String(item.value))
                  }
                  content={
                    <ChartLegendContent
                      nameKey="value"
                      className="flex-wrap justify-start [&>div:nth-last-child(2)]:ml-auto"
                    />
                  }
                />
              </ComposedChart>
            </ChartContainer>
          </>
        )}
      </CardContent>
    </Card>
  );
}
