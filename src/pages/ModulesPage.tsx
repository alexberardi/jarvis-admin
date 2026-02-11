import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useModules, useEnableModule, useDisableModule } from '@/hooks/useModules'
import ModuleToggleCard from '@/components/modules/ModuleToggleCard'
import { cn } from '@/lib/utils'

export default function ModulesPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useModules()
  const enableMutation = useEnableModule()
  const disableMutation = useDisableModule()

  const handleToggle = (id: string, enable: boolean) => {
    const mutation = enable ? enableMutation : disableMutation
    mutation.mutate(id, {
      onSuccess: (res) => toast.success(res.message),
      onError: (err) => toast.error(err.message),
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
        <p className="mb-2 text-red-500">Failed to load modules</p>
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

  const modules = data?.modules ?? []
  const enabled = modules.filter((m) => m.enabled)

  const togglingId =
    (enableMutation.isPending ? enableMutation.variables : null) ??
    (disableMutation.isPending ? disableMutation.variables : null)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--color-text)]">Modules</h1>

        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <span>
            {enabled.length}/{modules.length} enabled
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

      {modules.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            {data?.error
              ? data.error
              : 'No optional modules found. Configure a service registry to manage modules.'}
          </p>
        </div>
      )}

      {modules.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {modules.map((mod) => (
            <ModuleToggleCard
              key={mod.id}
              module={mod}
              onToggle={handleToggle}
              isToggling={togglingId === mod.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
