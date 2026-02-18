import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { usePipelineStatus, useArtifacts, useStartBuild, useCancelBuild } from '@/hooks/useTraining'
import ArtifactsCard from '@/components/training/ArtifactsCard'
import PipelineForm from '@/components/training/PipelineForm'
import LogViewer from '@/components/training/LogViewer'
import type { PipelineStep, BuildConfig } from '@/types/training'

export default function TrainingPage() {
  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
    isFetching: statusFetching,
  } = usePipelineStatus()

  const {
    data: artifacts,
    isLoading: artifactsLoading,
    refetch: refetchArtifacts,
  } = useArtifacts()

  const startBuild = useStartBuild()
  const cancelBuild = useCancelBuild()

  const isLoading = statusLoading || artifactsLoading
  const pipelineState = status?.state ?? 'idle'

  function handleStart(steps: PipelineStep[], config: BuildConfig) {
    startBuild.mutate(
      { steps, config },
      {
        onSuccess: () => toast.success('Pipeline started'),
        onError: (err) => toast.error(`Failed to start: ${err.message}`),
      },
    )
  }

  function handleCancel() {
    cancelBuild.mutate(undefined, {
      onSuccess: () => {
        toast.info('Pipeline cancelled')
        refetchArtifacts()
      },
      onError: (err) => toast.error(`Failed to cancel: ${err.message}`),
    })
  }

  function handleRefresh() {
    refetchStatus()
    refetchArtifacts()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="animate-spin text-[var(--color-primary)]" size={24} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Training Pipeline</h1>

        <div className="flex items-center gap-2">
          {status && (
            <StatusBadge state={pipelineState} />
          )}
          <button
            onClick={handleRefresh}
            disabled={statusFetching}
            className={cn(
              'rounded-lg p-1.5 hover:bg-[var(--color-surface-alt)]',
              statusFetching && 'animate-spin',
            )}
            title="Refresh"
          >
            <RefreshCw size={14} className="text-[var(--color-text-muted)]" />
          </button>
        </div>
      </div>

      {artifacts && <ArtifactsCard artifacts={artifacts} />}

      <PipelineForm
        pipelineState={pipelineState}
        artifacts={artifacts}
        onStart={handleStart}
        onCancel={handleCancel}
        isStarting={startBuild.isPending}
        isCancelling={cancelBuild.isPending}
      />

      <LogViewer pipelineState={pipelineState} />
    </div>
  )
}

function StatusBadge({ state }: { state: string }) {
  const styles: Record<string, string> = {
    idle: 'bg-gray-500/10 text-gray-400',
    running: 'bg-blue-500/10 text-blue-400',
    completed: 'bg-green-500/10 text-green-400',
    failed: 'bg-red-500/10 text-red-400',
    cancelled: 'bg-yellow-500/10 text-yellow-400',
  }

  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        styles[state] ?? styles.idle,
      )}
    >
      {state}
    </span>
  )
}
