import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Loader2, AlertTriangle, RefreshCw, GitMerge } from 'lucide-react'
import { cn } from '@/lib/utils'

type Phase = 'idle' | 'regenerate' | 'apply' | 'done' | 'error'

interface LogLine {
  text: string
  phase?: string
}

const PHASE_LABELS: Record<string, string> = {
  regenerate: 'Regenerating compose from registry',
  apply: 'Applying changes (docker compose up)',
  done: 'Complete',
}

export default function ReconcilePage() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('idle')
  const [logs, setLogs] = useState<LogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((line: LogLine) => {
    setLogs((prev) => [...prev, line])
  }, [])

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  async function handleReconcile() {
    setPhase('regenerate')
    setLogs([])
    setError(null)

    try {
      // AuthContext stores under the namespaced key; legacy "access_token" is
      // only set by the setup wizard's account step.
      const token =
        localStorage.getItem('jarvis-admin:access_token') ?? localStorage.getItem('access_token')
      const res = await fetch('/api/install/reconcile', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok || !res.body) {
        const body = await res.text()
        throw new Error(body || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.phase) setPhase(data.phase as Phase)
            if (data.message) addLog({ text: data.message, phase: data.phase })
            if (data.stream && data.text) addLog({ text: data.text.trim() })
            if (data.done && data.code !== 0) {
              throw new Error(data.message ?? 'Reconcile failed')
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setPhase('error')
      addLog({ text: `Error: ${msg}` })
    }
  }

  const completedPhases = Object.keys(PHASE_LABELS).filter((p) => {
    const order = Object.keys(PHASE_LABELS)
    const currentIdx = order.indexOf(phase)
    const phaseIdx = order.indexOf(p)
    return phaseIdx < currentIdx
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Sync Compose</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Regenerate <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-xs">docker-compose.yml</code> from the latest service registry and apply changes
          to the running stack. Adds new containers (e.g. background workers) without recreating
          unchanged services.
        </p>
      </div>

      {phase !== 'idle' && (
        <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          {Object.entries(PHASE_LABELS).map(([key, label]) => {
            const isActive = key === phase
            const isComplete = completedPhases.includes(key)
            const isError = key === phase && phase === 'error'
            return (
              <div key={key} className="flex items-center gap-2">
                {isComplete ? (
                  <CheckCircle2 size={16} className="text-green-500" />
                ) : isError ? (
                  <AlertTriangle size={16} className="text-red-500" />
                ) : isActive ? (
                  <Loader2 size={16} className="animate-spin text-[var(--color-primary)]" />
                ) : (
                  <div className="h-4 w-4 rounded-full border border-[var(--color-border)]" />
                )}
                <span
                  className={cn(
                    'text-sm',
                    isActive ? 'font-medium text-[var(--color-text)]' : 'text-[var(--color-text-muted)]',
                    isComplete && 'text-green-500',
                  )}
                >
                  {label}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {logs.length > 0 && (
        <div
          ref={logRef}
          className="max-h-64 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[#0d1117] p-3 font-mono text-xs text-gray-300"
        >
          {logs.map((line, i) => (
            <div key={i}>{line.text}</div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2">
          <AlertTriangle size={14} className="text-red-500" />
          <span className="text-sm text-red-500">{error}</span>
        </div>
      )}

      <div className="flex gap-3">
        {phase === 'idle' && (
          <button
            onClick={handleReconcile}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <GitMerge size={16} />
            Sync now
          </button>
        )}
        {phase === 'done' && (
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <CheckCircle2 size={16} />
            Back to dashboard
          </button>
        )}
        {phase === 'error' && (
          <button
            onClick={handleReconcile}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <RefreshCw size={16} />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}
