import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useContainers, useRestartContainer } from '@/hooks/useContainers'
import ServiceHealthCard from '@/components/dashboard/ServiceHealthCard'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useContainers()
  const restartMutation = useRestartContainer()

  const handleRestart = (id: string) => {
    restartMutation.mutate(id, {
      onSuccess: () => toast.success('Container restart initiated'),
      onError: (err) => toast.error(`Restart failed: ${err.message}`),
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="animate-spin text-[var(--color-primary)]" size={24} />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="py-20 text-center">
        <p className="mb-2 text-red-500">Failed to load containers</p>
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          {(error as Error)?.message ?? 'Unknown error'}
        </p>
        <button
          onClick={() => refetch()}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm text-white hover:opacity-90"
        >
          Retry
        </button>
      </div>
    )
  }

  const containers = data?.containers ?? []
  const running = containers.filter((c) => c.state === 'running')
  const stopped = containers.filter((c) => c.state !== 'running')

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Dashboard</h1>

        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <span>
            {running.length}/{containers.length} running
          </span>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className={cn(
              'rounded-lg p-1.5 hover:bg-[var(--color-surface-alt)]',
              isFetching && 'animate-spin',
            )}
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {containers.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            {data?.error
              ? data.error
              : 'No Jarvis containers found. Is Docker running?'}
          </p>
        </div>
      )}

      {running.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Running
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {running.map((c) => (
              <ServiceHealthCard
                key={c.id}
                container={c}
                onRestart={handleRestart}
                isRestarting={
                  restartMutation.isPending && restartMutation.variables === c.id
                }
              />
            ))}
          </div>
        </div>
      )}

      {stopped.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Stopped
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {stopped.map((c) => (
              <ServiceHealthCard
                key={c.id}
                container={c}
                onRestart={handleRestart}
                isRestarting={
                  restartMutation.isPending && restartMutation.variables === c.id
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
