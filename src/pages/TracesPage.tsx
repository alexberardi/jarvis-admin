import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { fetchTraces, type TraceListItem } from '@/api/traces'

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function TracesPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [sourceFilter, setSourceFilter] = useState<string>('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['traces', statusFilter, sourceFilter],
    queryFn: () =>
      fetchTraces({
        limit: 100,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(sourceFilter ? { source: sourceFilter } : {}),
      }),
    refetchInterval: 10_000,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Request Traces</h1>
        <div className="flex items-center gap-2">
          <select
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="ok">OK</option>
            <option value="error">Error</option>
          </select>
          <select
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="">All sources</option>
            <option value="node">Node</option>
            <option value="mobile">Mobile</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400">
          Failed to load traces
        </div>
      )}

      {data && (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">{data.total} traces</p>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                  <th className="px-3 py-2 text-left font-medium text-[var(--color-text-muted)]">Time</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--color-text-muted)]">Source</th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--color-text-muted)]">Command</th>
                  <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">Duration</th>
                  <th className="px-3 py-2 text-center font-medium text-[var(--color-text-muted)]">Status</th>
                  <th className="px-3 py-2 text-right font-medium text-[var(--color-text-muted)]">Spans</th>
                </tr>
              </thead>
              <tbody>
                {data.traces.map((trace: TraceListItem) => (
                  <tr
                    key={trace.id}
                    className="border-b border-[var(--color-border)] cursor-pointer transition-colors hover:bg-[var(--color-surface-alt)]"
                    onClick={() => navigate(`/traces/${trace.id}`)}
                  >
                    <td className="px-3 py-2 text-[var(--color-text)] whitespace-nowrap">
                      {trace.created_at ? formatTime(trace.created_at) : '-'}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                      <span className="inline-flex items-center gap-1">
                        {trace.source === 'mobile' ? '📱' : '🔊'}
                        {trace.source}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text)] max-w-xs truncate">
                      {trace.user_command ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text)] tabular-nums">
                      {formatDuration(trace.total_duration_ms)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          trace.status === 'ok' ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-[var(--color-text-muted)] tabular-nums">
                      {trace.span_count}
                    </td>
                  </tr>
                ))}
                {data.traces.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                      No traces yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
