import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpCircle, CheckCircle2, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'

type Phase = 'idle' | 'preflight' | 'download' | 'binary' | 'restarting' | 'compose' | 'pull' | 'restart' | 'verify' | 'done' | 'error'

interface LogLine {
  text: string
  phase?: string
}

const PHASE_LABELS: Record<string, string> = {
  preflight: 'Checking prerequisites',
  download: 'Downloading update',
  binary: 'Updating binary',
  restarting: 'Restarting admin server',
  compose: 'Updating configuration',
  pull: 'Pulling images',
  restart: 'Restarting services',
  verify: 'Verifying health',
  done: 'Complete',
}

export default function UpdatePage() {
  const navigate = useNavigate()
  const { data: updateInfo, isLoading } = useUpdateCheck()
  const [phase, setPhase] = useState<Phase>('idle')
  const [logs, setLogs] = useState<LogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((line: LogLine) => {
    setLogs((prev) => [...prev, line])
  }, [])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  async function handleUpdate() {
    setPhase('preflight')
    setLogs([])
    setError(null)

    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch('/api/update/apply', {
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

            if (data.restart) {
              setPhase('restarting')
              addLog({ text: 'Admin server restarting with new version...' })
              await waitForRestart(updateInfo?.latestVersion ?? '')
              // After restart, check if upgrade continued
              setPhase('done')
              addLog({ text: 'Upgrade complete!' })
              return
            }

            if (data.done && data.code !== 0) {
              throw new Error(data.error ?? 'Upgrade failed')
            }
            if (data.done && data.code === 0) {
              setPhase('done')
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

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 size={24} className="animate-spin text-[var(--color-primary)]" />
      </div>
    )
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
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Update Jarvis</h1>
        {updateInfo?.updateAvailable ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            v{updateInfo.currentVersion} → v{updateInfo.latestVersion}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            You're running the latest version (v{updateInfo?.currentVersion ?? '?'})
          </p>
        )}
      </div>

      {/* Phase progress */}
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

      {/* Log output */}
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

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2">
          <AlertTriangle size={14} className="text-red-500" />
          <span className="text-sm text-red-500">{error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {phase === 'idle' && updateInfo?.updateAvailable && (
          <button
            onClick={handleUpdate}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <ArrowUpCircle size={16} />
            Update to v{updateInfo.latestVersion}
          </button>
        )}
        {phase === 'done' && (
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <CheckCircle2 size={16} />
            Go to Dashboard
          </button>
        )}
        {phase === 'error' && (
          <button
            onClick={handleUpdate}
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

/** Poll /health until the new version responds. */
async function waitForRestart(_targetVersion: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const res = await fetch('/health')
      if (res.ok) {
        const data = await res.json() as { version?: string }
        if (data.version && data.version !== '0.0.0-dev') {
          return // New version is up
        }
      }
    } catch {
      // Not ready yet
    }
  }
  throw new Error('Admin server did not restart within 60 seconds')
}
