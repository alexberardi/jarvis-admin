import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, Copy, Check, AlertTriangle, FolderOpen, Info } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useServiceRegistry, useRegisterServices, useRotateKey } from '@/hooks/useServices'
import { probeServiceHealth } from '@/api/services'
import ServiceRegistrationRow from '@/components/services/ServiceRegistrationRow'
import type { HealthStatus } from '@/components/services/ServiceRegistrationRow'
import type {
  ServiceRegisterItem,
  ServiceRegisterResult,
  KeyRotateResponse,
} from '@/types/services'

interface RowState {
  checked: boolean
  host: string
  port: number
}

interface HealthState {
  status: HealthStatus
  error?: string
  latency?: number
}

export default function ServicesPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useServiceRegistry()
  const mutation = useRegisterServices()
  const rotateMutation = useRotateKey()

  const [rowStates, setRowStates] = useState<Record<string, RowState>>({})
  const [results, setResults] = useState<ServiceRegisterResult[] | null>(null)
  const [rotateResult, setRotateResult] = useState<KeyRotateResponse | null>(null)
  const [rotatingService, setRotatingService] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [basePath, setBasePath] = useState('')
  const [healthStates, setHealthStates] = useState<Record<string, HealthState>>({})

  // Auto-fill basePath from config-service's JARVIS_ROOT (volume-mounted path)
  useEffect(() => {
    if (data?.jarvis_root && !basePath) {
      setBasePath(data.jarvis_root)
    }
  }, [data?.jarvis_root]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive the effective state for each row (local override or defaults from server)
  const getRowState = useCallback(
    (name: string): RowState => {
      if (rowStates[name]) return rowStates[name]
      const entry = data?.services.find((s) => s.name === name)
      if (!entry) return { checked: false, host: 'localhost', port: 0 }
      return {
        checked: entry.config_registered,
        host: entry.current_host ?? 'localhost',
        port: entry.current_port ?? entry.default_port,
      }
    },
    [rowStates, data],
  )

  const updateRow = useCallback((name: string, patch: Partial<RowState>) => {
    setRowStates((prev) => {
      const current = prev[name] ?? { checked: false, host: 'localhost', port: 0 }
      return { ...prev, [name]: { ...current, ...patch } }
    })
  }, [])

  const probeHealth = useCallback(
    async (name: string, host: string, port: number, healthPath: string) => {
      if (!host || !port) return

      setHealthStates((prev) => ({ ...prev, [name]: { status: 'probing' } }))
      try {
        const resp = await probeServiceHealth({ host, port, health_path: healthPath })
        setHealthStates((prev) => ({
          ...prev,
          [name]: {
            status: resp.healthy ? 'healthy' : 'unhealthy',
            error: resp.error ?? undefined,
            latency: resp.latency_ms ?? undefined,
          },
        }))
      } catch {
        setHealthStates((prev) => ({
          ...prev,
          [name]: { status: 'unhealthy', error: 'Request failed' },
        }))
      }
    },
    [],
  )

  const handleRegister = useCallback(() => {
    if (!data) return

    const items: ServiceRegisterItem[] = data.services
      .filter((entry) => getRowState(entry.name).checked)
      .map((entry) => {
        const state = getRowState(entry.name)
        return { name: entry.name, host: state.host, port: state.port }
      })

    if (items.length === 0) {
      toast.error('No services selected')
      return
    }

    setResults(null)
    setRotateResult(null)
    mutation.mutate(
      {
        services: items,
        base_path: basePath.trim() || null,
      },
      {
        onSuccess: (resp) => {
          setResults(resp.results)
          const ok = resp.results.filter((r) => r.config_ok && r.auth_ok).length
          const total = resp.results.length
          if (ok === total) {
            toast.success(`All ${total} services registered`)
          } else {
            toast.warning(`${ok}/${total} services registered successfully`)
          }
        },
        onError: (err) => {
          toast.error(`Registration failed: ${err.message}`)
        },
      },
    )
  }, [data, getRowState, mutation, basePath])

  const handleRotateKey = useCallback(
    (serviceName: string) => {
      setRotatingService(serviceName)
      setRotateResult(null)
      rotateMutation.mutate(
        {
          service_name: serviceName,
          base_path: basePath.trim() || null,
        },
        {
          onSuccess: (resp) => {
            setRotateResult(resp)
            setRotatingService(null)
            toast.success(`Key rotated for ${serviceName}`)
          },
          onError: (err) => {
            setRotatingService(null)
            toast.error(`Key rotation failed: ${err.message}`)
          },
        },
      )
    },
    [rotateMutation, basePath],
  )

  const handleCopyKey = useCallback((key: string) => {
    navigator.clipboard.writeText(key).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    })
  }, [])

  const checkedCount = data?.services.filter((e) => getRowState(e.name).checked).length ?? 0
  const hasEnvWrites =
    results?.some((r) => r.env_written) || rotateResult?.env_written === true

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
        <p className="mb-2 text-red-500">Failed to load service registry</p>
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

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-[var(--color-text)]">Services</h1>
          <span className="rounded-full bg-[var(--color-surface-alt)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
            {data?.services.length ?? 0}
          </span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className={cn(
            'rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]',
            isFetching && 'animate-spin',
          )}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Service list */}
      <div className="space-y-2">
        {data?.services.map((entry) => {
          const state = getRowState(entry.name)
          const health = healthStates[entry.name] ?? { status: 'idle' as const }
          return (
            <ServiceRegistrationRow
              key={entry.name}
              entry={entry}
              checked={state.checked}
              host={state.host}
              port={state.port}
              onToggle={() => {
                const nowChecked = !state.checked
                updateRow(entry.name, { ...state, checked: nowChecked })
                if (nowChecked) {
                  probeHealth(entry.name, state.host, state.port, entry.health_path)
                } else {
                  setHealthStates((prev) => ({ ...prev, [entry.name]: { status: 'idle' } }))
                }
              }}
              onHostChange={(host) => updateRow(entry.name, { ...state, host })}
              onPortChange={(port) => updateRow(entry.name, { ...state, port })}
              onHostBlur={() => {
                if (state.checked) {
                  probeHealth(entry.name, state.host, state.port, entry.health_path)
                }
              }}
              onPortBlur={() => {
                if (state.checked) {
                  probeHealth(entry.name, state.host, state.port, entry.health_path)
                }
              }}
              onRotateKey={() => handleRotateKey(entry.name)}
              disabled={mutation.isPending}
              rotating={rotatingService === entry.name}
              healthStatus={health.status}
              healthError={health.error}
              healthLatency={health.latency}
            />
          )
        })}
      </div>

      {/* Base path + register button */}
      <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)]">
            <FolderOpen size={14} />
            Jarvis directory (optional)
          </label>
          <input
            type="text"
            value={basePath}
            onChange={(e) => setBasePath(e.target.value)}
            disabled={mutation.isPending}
            placeholder="/home/alex/jarvis"
            className={cn(
              'w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-1.5',
              'text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
              'outline-none focus:ring-1 focus:ring-[var(--color-primary)]',
              'disabled:opacity-50',
            )}
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Writes JARVIS_APP_ID and JARVIS_APP_KEY to each service's .env file
          </p>
        </div>

        <button
          onClick={handleRegister}
          disabled={mutation.isPending || checkedCount === 0}
          className={cn(
            'rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white',
            'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {mutation.isPending ? 'Registering...' : `Register Selected (${checkedCount})`}
        </button>
      </div>

      {/* Rotate key result */}
      {rotateResult && (
        <KeyResultPanel
          serviceName={rotateResult.service_name}
          appKey={rotateResult.app_key}
          envWritten={rotateResult.env_written}
          copiedKey={copiedKey}
          onCopy={handleCopyKey}
          label="Rotated Key"
        />
      )}

      {/* Registration results */}
      {results && (
        <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Registration Results</h2>
          {results.map((r) => (
            <div
              key={r.name}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm',
                r.config_ok && r.auth_ok
                  ? 'border-green-500/20 bg-green-500/5'
                  : 'border-yellow-500/20 bg-yellow-500/5',
              )}
            >
              <span className="min-w-[180px] font-medium text-[var(--color-text)]">{r.name}</span>

              <span
                className={cn(
                  'text-xs',
                  r.config_ok ? 'text-green-600 dark:text-green-400' : 'text-red-500',
                )}
              >
                Config: {r.config_ok ? 'OK' : 'Failed'}
              </span>

              <span
                className={cn(
                  'text-xs',
                  r.auth_ok ? 'text-green-600 dark:text-green-400' : 'text-red-500',
                )}
              >
                Auth: {r.auth_ok ? (r.auth_created ? 'Created' : 'Exists') : 'Failed'}
              </span>

              {r.env_written !== null && (
                <span
                  className={cn(
                    'text-xs',
                    r.env_written ? 'text-green-600 dark:text-green-400' : 'text-red-500',
                  )}
                >
                  .env: {r.env_written ? 'Written' : 'Failed'}
                </span>
              )}

              {r.error && (
                <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
                  <AlertTriangle size={12} />
                  {r.error}
                </span>
              )}

              {r.auth_created && r.app_key && (
                <div className="mt-1 w-full">
                  <div className="mb-1 flex items-center gap-1 text-xs font-medium text-yellow-600 dark:text-yellow-400">
                    <AlertTriangle size={12} />
                    App key (shown once only):
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 overflow-x-auto rounded bg-[var(--color-background)] px-2 py-1 font-mono text-xs text-[var(--color-text)]">
                      {r.app_key}
                    </code>
                    <button
                      onClick={() => handleCopyKey(r.app_key!)}
                      className="rounded p-1 hover:bg-[var(--color-surface-alt)]"
                      title="Copy to clipboard"
                    >
                      {copiedKey === r.app_key ? (
                        <Check size={14} className="text-green-500" />
                      ) : (
                        <Copy size={14} className="text-[var(--color-text-muted)]" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Restart notice */}
      {hasEnvWrites && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
          <Info size={16} className="mt-0.5 shrink-0 text-blue-500" />
          <p className="text-sm text-[var(--color-text)]">
            Services whose .env files were updated need to be restarted to pick up the new
            credentials. Restart each affected service's container or process.
          </p>
        </div>
      )}
    </div>
  )
}

function KeyResultPanel({
  serviceName,
  appKey,
  envWritten,
  copiedKey,
  onCopy,
  label,
}: {
  serviceName: string
  appKey: string
  envWritten: boolean | null
  copiedKey: string | null
  onCopy: (key: string) => void
  label: string
}) {
  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">
        {label}: {serviceName}
      </h2>
      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
        {envWritten !== null && (
          <span
            className={cn(
              'mb-2 inline-block text-xs',
              envWritten ? 'text-green-600 dark:text-green-400' : 'text-red-500',
            )}
          >
            .env: {envWritten ? 'Written' : 'Failed'}
          </span>
        )}
        <div>
          <div className="mb-1 flex items-center gap-1 text-xs font-medium text-yellow-600 dark:text-yellow-400">
            <AlertTriangle size={12} />
            New app key (shown once only):
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-[var(--color-background)] px-2 py-1 font-mono text-xs text-[var(--color-text)]">
              {appKey}
            </code>
            <button
              onClick={() => onCopy(appKey)}
              className="rounded p-1 hover:bg-[var(--color-surface-alt)]"
              title="Copy to clipboard"
            >
              {copiedKey === appKey ? (
                <Check size={14} className="text-green-500" />
              ) : (
                <Copy size={14} className="text-[var(--color-text-muted)]" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
