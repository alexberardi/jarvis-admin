import { Check, X, RotateCw, Loader2, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnownServiceEntry } from '@/types/services'

export type HealthStatus = 'idle' | 'probing' | 'healthy' | 'unhealthy'

interface ServiceRegistrationRowProps {
  entry: KnownServiceEntry
  checked: boolean
  host: string
  port: number
  onToggle: () => void
  onHostChange: (host: string) => void
  onPortChange: (port: number) => void
  onHostBlur: () => void
  onPortBlur: () => void
  onRotateKey: () => void
  disabled: boolean
  rotating: boolean
  healthStatus: HealthStatus
  healthError?: string
  healthLatency?: number
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        ok
          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
          : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]',
      )}
    >
      {ok ? <Check size={12} /> : <X size={12} />}
      {label}
    </span>
  )
}

function HealthIndicator({
  status,
  error,
  latency,
}: {
  status: HealthStatus
  error?: string
  latency?: number
}) {
  if (status === 'idle') return null

  if (status === 'probing') {
    return (
      <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
        <Loader2 size={12} className="animate-spin" />
      </span>
    )
  }

  if (status === 'healthy') {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <Circle size={8} fill="currentColor" />
        {latency != null && `${latency}ms`}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1 text-xs text-red-500" title={error}>
      <Circle size={8} fill="currentColor" />
      {error || 'Unreachable'}
    </span>
  )
}

export default function ServiceRegistrationRow({
  entry,
  checked,
  host,
  port,
  onToggle,
  onHostChange,
  onPortChange,
  onHostBlur,
  onPortBlur,
  onRotateKey,
  disabled,
  rotating,
  healthStatus,
  healthError,
  healthLatency,
}: ServiceRegistrationRowProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] p-3',
        'bg-[var(--color-surface)] transition-colors',
        checked && 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
      />

      <div className="min-w-[180px] flex-1">
        <div className="text-sm font-medium text-[var(--color-text)]">{entry.name}</div>
        <div className="text-xs text-[var(--color-text-muted)]">{entry.description}</div>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge ok={entry.config_registered} label="Config" />
        <StatusBadge ok={entry.auth_registered} label="Auth" />
        {entry.auth_registered && (
          <button
            onClick={onRotateKey}
            disabled={disabled || rotating}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]',
              'hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)]',
              'disabled:opacity-50',
            )}
            title="Rotate app key"
          >
            <RotateCw size={12} className={rotating ? 'animate-spin' : ''} />
            Rotate Key
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={host}
          onChange={(e) => onHostChange(e.target.value)}
          onBlur={onHostBlur}
          disabled={disabled}
          placeholder="host"
          className={cn(
            'w-36 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1',
            'text-xs text-[var(--color-text)] outline-none focus:ring-1 focus:ring-[var(--color-primary)]',
            'disabled:opacity-50',
          )}
        />
        <span className="text-xs text-[var(--color-text-muted)]">:</span>
        <input
          type="number"
          value={port}
          onChange={(e) => onPortChange(Number(e.target.value))}
          onBlur={onPortBlur}
          disabled={disabled}
          className={cn(
            'w-20 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1',
            'text-xs text-[var(--color-text)] outline-none focus:ring-1 focus:ring-[var(--color-primary)]',
            'disabled:opacity-50',
          )}
        />
        <HealthIndicator status={healthStatus} error={healthError} latency={healthLatency} />
      </div>
    </div>
  )
}
