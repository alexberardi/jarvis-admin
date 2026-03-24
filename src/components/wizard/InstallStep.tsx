import { useState } from 'react'
import { CheckCircle2, XCircle, Loader2, Play, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWizard } from '@/context/WizardContext'
import { useInstallStream } from '@/hooks/useInstallStream'
import { generateInstall, getInstallHealth } from '@/api/install'
import TerminalOutput from './TerminalOutput'
import type { HealthStatus } from '@/types/wizard'

type Phase = 'idle' | 'generating' | 'pulling' | 'starting' | 'registering' | 'verifying' | 'done' | 'error'

export default function InstallStep() {
  const { state } = useWizard()
  const pullStream = useInstallStream()
  const startStream = useInstallStream()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null)

  async function runInstall() {
    setError(null)

    try {
      // Phase 1: Generate config files
      setPhase('generating')
      await generateInstall(state)

      // Phase 2: Pull images (SSE stream → Promise)
      setPhase('pulling')
      await pullStream.run('/api/install/pull')

      // Phase 3: Tiered startup — infra → config → auth → register → all services
      // This single SSE stream handles starting, registration, and credential injection
      setPhase('starting')
      await startStream.run('/api/install/start')

      // Phase 4: Verify health
      setPhase('verifying')
      await new Promise((r) => setTimeout(r, 5000))
      const health = await getInstallHealth()
      setHealthStatus(health)

      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  const phases: Array<{ key: Phase; label: string }> = [
    { key: 'generating', label: 'Generate configuration' },
    { key: 'pulling', label: 'Pull Docker images' },
    { key: 'starting', label: 'Start services' },
    { key: 'verifying', label: 'Verify health' },
  ]

  const phaseOrder = phases.map((p) => p.key)
  const currentPhaseIdx = phaseOrder.indexOf(phase as Phase)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--color-text)]">Install</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {phase === 'idle'
            ? 'Ready to install. This will pull Docker images and start all services.'
            : phase === 'done'
              ? 'Installation complete! All services are running.'
              : phase === 'error'
                ? 'Installation encountered an error.'
                : 'Installing...'}
        </p>
      </div>

      {/* Progress steps */}
      <div className="space-y-2">
        {phases.map((p, i) => {
          const isActive = p.key === phase
          const isDone = currentPhaseIdx > i || phase === 'done'
          const isFailed = phase === 'error' && isActive

          return (
            <div key={p.key} className="flex items-center gap-3">
              {isDone ? (
                <CheckCircle2 size={18} className="text-green-500" />
              ) : isFailed ? (
                <XCircle size={18} className="text-red-500" />
              ) : isActive ? (
                <Loader2 size={18} className="animate-spin text-[var(--color-primary)]" />
              ) : (
                <div className="h-[18px] w-[18px] rounded-full border-2 border-[var(--color-border)]" />
              )}
              <span
                className={cn(
                  'text-sm',
                  isDone
                    ? 'text-green-500'
                    : isActive
                      ? 'font-medium text-[var(--color-text)]'
                      : 'text-[var(--color-text-muted)]',
                )}
              >
                {p.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Terminal output */}
      {(pullStream.lines.length > 0 || pullStream.running) && (
        <TerminalOutput
          lines={pullStream.lines}
          running={pullStream.running}
          title="docker compose pull"
        />
      )}

      {(startStream.lines.length > 0 || startStream.running) && (
        <TerminalOutput
          lines={startStream.lines}
          running={startStream.running}
          title="docker compose up -d"
        />
      )}

      {/* Health status */}
      {healthStatus && (
        <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">Service Health</span>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {Object.entries(healthStatus).map(([id, status]) => (
              <div key={id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm text-[var(--color-text)]">{id}</span>
                {status.healthy ? (
                  <CheckCircle2 size={14} className="text-green-500" />
                ) : (
                  <XCircle size={14} className="text-red-500" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</div>
      )}

      {/* Start / Retry button */}
      {(phase === 'idle' || phase === 'error') && (
        <button
          type="button"
          onClick={runInstall}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-3 font-medium text-white',
            'hover:opacity-90 transition-opacity',
          )}
        >
          {phase === 'error' ? <RotateCcw size={18} /> : <Play size={18} />}
          {phase === 'error' ? 'Retry Installation' : 'Start Installation'}
        </button>
      )}
    </div>
  )
}
