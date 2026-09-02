import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'

import { CAPABILITIES } from '@/lib/constant'
import { formatUsd, reportWindowStart } from '@/lib/utils'
import { api } from '@/trpc/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DailyStackedChart,
  UsageModule,
  UsageModuleSkeleton,
} from '@/components/usage-module'
import { UsageQuantity } from '@/components/usage-quantity'
import { UsageUnitPrice } from '@/components/usage-unit-price'

export default function UsagePage() {
  const utils = api.useUtils()
  const [days, setDays] = useState(7)
  const [refreshing, setRefreshing] = useState(false)
  const from = useMemo(() => reportWindowStart(days), [days])
  const { data, isLoading } = api.usage.adminList.useQuery({ from })

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await utils.usage.invalidate()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Stats</h2>
          <div className="flex items-center gap-2">
            <Select
              value={String(days)}
              onValueChange={(v) => setDays(Number(v))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Today</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh"
            >
              <RefreshCw
                className={`size-4 ${refreshing ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <UsageModuleSkeleton isAdmin />
        ) : (
          data && (
            <>
              <UsageModule
                kpi={data.kpi}
                rows={data.rows}
                days={days}
                chartTitle="Daily model cost"
              />
              <DailyStackedChart
                rows={data.rows}
                groupBy="provider"
                days={days}
                title="Daily provider cost"
              />
              <DailyStackedChart
                rows={data.rows}
                groupBy="capability"
                days={days}
                title="Daily capability cost"
              />
            </>
          )
        )}

        <UsageLog days={days} />
      </section>
    </div>
  )
}

function UsageLog({ days }: { days: number }) {
  const [userQuery, setUserQuery] = useState('')
  const [modelId, setModelId] = useState<string>('')
  const [capability, setCapability] = useState<string>('')
  const [page, setPage] = useState(1)
  const pageSize = 50

  // Reset to page 1 when the window changes.
  useEffect(() => {
    setPage(1)
  }, [days])

  const from = useMemo(() => reportWindowStart(days), [days])

  const { data: models } = api.model.list.useQuery()

  const { data, isLoading } = api.usage.adminLog.useQuery({
    from,
    userQuery: userQuery.trim() || undefined,
    modelId: modelId || undefined,
    capability: capability
      ? (capability as 'chat' | 'image' | 'video' | 'audio')
      : undefined,
    page,
    pageSize,
  })

  const totalPages = useMemo(() => {
    if (!data) return 1
    return Math.max(1, Math.ceil(data.total / pageSize))
  }, [data])

  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <div className="mb-3 text-base font-medium">Logs</div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search user (name or email)..."
            value={userQuery}
            onChange={(e) => {
              setUserQuery(e.target.value)
              setPage(1)
            }}
            className="w-64"
          />
          <Select
            value={modelId || '__all__'}
            onValueChange={(v) => {
              setModelId(v === '__all__' ? '' : v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All models" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All models</SelectItem>
              {models?.map((m) => (
                <SelectItem key={m.id} value={m.modelId}>
                  {m.modelId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={capability || '__all__'}
            onValueChange={(v) => {
              setCapability(v === '__all__' ? '' : v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All capabilities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All capabilities</SelectItem>
              {CAPABILITIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-2 text-left font-medium">Time</th>
                <th className="p-2 text-left font-medium">User</th>
                <th className="p-2 text-left font-medium">Model</th>
                <th className="p-2 text-left font-medium">Quantity</th>
                <th className="p-2 text-left font-medium">Unit Price</th>
                <th className="p-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="p-6 text-center text-muted-foreground"
                  >
                    Loading...
                  </td>
                </tr>
              ) : data?.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="p-6 text-center text-muted-foreground"
                  >
                    No records.
                  </td>
                </tr>
              ) : (
                data?.rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2 text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="p-2 text-sm">
                      <Link
                        to="/console/users/$userId"
                        params={{ userId: r.userId }}
                        className="hover:text-primary"
                      >
                        <div className="font-medium">
                          {r.userName ?? 'Unknown'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.userEmail}
                        </div>
                      </Link>
                    </td>
                    <td className="p-2 align-middle">
                      <div className="text-xs text-muted-foreground">
                        {r.capability}
                      </div>
                      <div className="font-mono text-xs">
                        {r.modelId ?? '—'}
                      </div>
                    </td>
                    <UsageQuantity row={r} />
                    <UsageUnitPrice row={r} />
                    <td className="p-2 text-right font-mono text-sm">
                      {formatUsd(r.cost)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > pageSize && (
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {page} of {totalPages} · {data.total} records
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border px-2 py-1 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border px-2 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
