import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Brain } from 'lucide-react'
import { toast } from 'sonner'
import { useContainers, useRestartContainer } from '@/hooks/useContainers'
import { useLlmStatus } from '@/hooks/useLlmSetup'
import ServiceHealthCard from '@/components/dashboard/ServiceHealthCard'
import { cn } from '@/lib/utils'

const LLM_SETUP_DISMISSED_KEY = 'jarvis-admin:llm-setup-dismissed'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError, error, refetch, isFetching } = useContainers()
  const restartMutation = useRestartContainer()
  const llmStatus = useLlmStatus()
  const [showLlmBanner, setShowLlmBanner] = useState(false)

  useEffect(() => {
    if (llmStatus.data && !llmStatus.data.configured) {
      const dismissed = localStorage.getItem(LLM_SETUP_DISMISSED_KEY)
      if (!dismissed) {
        setShowLlmBanner(true)
      }
    }
  }, [llmStatus.data])

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

      {showLlmBanner && (
        <div className="flex items-center justify-between rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 p-4">
          <div className="flex items-center gap-3">
            <Brain size={20} className="text-[var(--color-primary)]" />
            <div>
              <p className="text-sm font-medium text-[var(--color-text)]">
                LLM not configured
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Set up a language model to enable voice command processing
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                localStorage.setItem(LLM_SETUP_DISMISSED_KEY, 'true')
                setShowLlmBanner(false)
              }}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Dismiss
            </button>
            <button
              onClick={() => navigate('/llm-setup')}
              className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs text-white hover:opacity-90"
            >
              Set up LLM
            </button>
          </div>
        </div>
      )}

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
