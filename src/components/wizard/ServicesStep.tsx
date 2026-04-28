import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Lock, Loader2, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWizard } from '@/context/WizardContext'
import { getServiceRegistry, getInstallDefaults } from '@/api/install'
import type { ServiceRegistry, ServiceDefinition } from '@/types/wizard'

export default function ServicesStep() {
  const { state, dispatch } = useWizard()
  const [registry, setRegistry] = useState<ServiceRegistry | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getServiceRegistry(), getInstallDefaults()])
      .then(([reg, defaults]) => {
        setRegistry(reg)
        // Initialize with defaults if not already set
        if (state.enabledModules.length === 0) {
          dispatch({ type: 'SET_ENABLED_MODULES', modules: defaults.enabledModules })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !registry) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={32} className="animate-spin text-[var(--color-primary)]" />
      </div>
    )
  }

  const { core, recommended, optional } = groupByCategory(registry.services)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--color-text)]">Select Services</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Core services are always included. Toggle recommended and optional services.
        </p>
      </div>

      {/* Core — locked on */}
      <ServiceGroup
        title="Core"
        subtitle="Always included"
        services={core}
        enabled={core.map((s) => s.id)}
        locked
      />

      {/* Recommended — togglable */}
      <ServiceGroup
        title="Recommended"
        subtitle="Enabled by default"
        services={recommended}
        enabled={state.enabledModules}
        onToggle={(id, enabled) => dispatch({ type: 'TOGGLE_MODULE', serviceId: id, enabled })}
        platform={state.platform}
      />

      {/* Optional */}
      {optional.length > 0 && (
        <ServiceGroup
          title="Optional"
          subtitle="Off by default"
          services={optional}
          enabled={state.enabledModules}
          onToggle={(id, enabled) => dispatch({ type: 'TOGGLE_MODULE', serviceId: id, enabled })}
        />
      )}

      {/* Integrations */}
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <h3 className="text-sm font-medium text-[var(--color-text)]">Integrations</h3>
          <span className="text-xs text-[var(--color-text-muted)]">Cloud services</span>
        </div>
        <button
          type="button"
          onClick={() => dispatch({ type: 'SET_RELAY_ENABLED', enabled: !state.relayEnabled })}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
            state.relayEnabled
              ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5'
              : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/30',
          )}
        >
          {state.relayEnabled ? (
            <CheckCircle2 size={16} className="shrink-0 text-[var(--color-primary)]" />
          ) : (
            <Circle size={16} className="shrink-0 text-[var(--color-text-muted)]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--color-text)]">Jarvis Relay</span>
              <Globe size={12} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Routes OAuth callbacks through a cloud relay for external providers (Google, Spotify, etc.)
            </p>
          </div>
        </button>
      </div>
    </div>
  )
}

function groupByCategory(services: ServiceDefinition[]) {
  return {
    core: services.filter((s) => s.category === 'core'),
    recommended: services.filter((s) => s.category === 'recommended'),
    optional: services.filter((s) => s.category === 'optional'),
  }
}

interface ServiceGroupProps {
  title: string
  subtitle: string
  services: ServiceDefinition[]
  enabled: string[]
  locked?: boolean
  onToggle?: (id: string, enabled: boolean) => void
  platform?: 'darwin' | 'linux'
}

function ServiceGroup({
  title,
  subtitle,
  services,
  enabled,
  locked,
  onToggle,
  platform,
}: ServiceGroupProps) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-medium text-[var(--color-text)]">{title}</h3>
        <span className="text-xs text-[var(--color-text-muted)]">{subtitle}</span>
      </div>
      <div className="space-y-1">
        {services.map((svc) => {
          const isEnabled = enabled.includes(svc.id)
          const isNative = svc.nativeOnly && platform === 'darwin'

          return (
            <button
              key={svc.id}
              type="button"
              disabled={locked}
              onClick={() => onToggle?.(svc.id, !isEnabled)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                isEnabled
                  ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5'
                  : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/30',
                locked && 'cursor-default',
              )}
            >
              {locked ? (
                <Lock size={16} className="shrink-0 text-[var(--color-text-muted)]" />
              ) : isEnabled ? (
                <CheckCircle2 size={16} className="shrink-0 text-[var(--color-primary)]" />
              ) : (
                <Circle size={16} className="shrink-0 text-[var(--color-text-muted)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-text)]">{svc.name}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">:{svc.port}</span>
                  {isNative && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                      Native
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-[var(--color-text-muted)]">{svc.description}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
