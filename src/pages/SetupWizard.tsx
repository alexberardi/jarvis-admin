import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/api/client'
import { cn } from '@/lib/utils'

type ProbeStatus = 'idle' | 'probing' | 'ok' | 'error'

export default function SetupWizard() {
  const navigate = useNavigate()
  const [authUrl, setAuthUrl] = useState('http://localhost:8007')
  const [configUrl, setConfigUrl] = useState('http://localhost:8013')
  const [authStatus, setAuthStatus] = useState<ProbeStatus>('idle')
  const [configStatus, setConfigStatus] = useState<ProbeStatus>('idle')
  const [authError, setAuthError] = useState('')
  const [configError, setConfigError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputClass = cn(
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2',
    'text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
    'outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
    'font-mono text-sm',
  )

  const probeUrl = async (
    url: string,
    setStatus: (s: ProbeStatus) => void,
    setErr: (e: string) => void,
  ) => {
    setStatus('probing')
    setErr('')
    try {
      const { data } = await apiClient.post<{ healthy: boolean; error?: string }>(
        '/api/setup/probe',
        { url },
      )
      if (data.healthy) {
        setStatus('ok')
      } else {
        setStatus('error')
        setErr(data.error ?? 'Health check failed')
      }
    } catch (err: unknown) {
      setStatus('error')
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Connection failed'
      setErr(msg)
    }
  }

  const handleProbeAuth = () => probeUrl(authUrl, setAuthStatus, setAuthError)
  const handleProbeConfig = () => probeUrl(configUrl, setConfigStatus, setConfigError)

  const bothHealthy = authStatus === 'ok' && configStatus === 'ok'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!bothHealthy) return

    setSaving(true)
    setError(null)
    try {
      await apiClient.post('/api/setup/configure', { authUrl, configUrl })
      navigate('/login')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save configuration'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const statusBadge = (status: ProbeStatus, errMsg: string) => {
    switch (status) {
      case 'idle':
        return <span className="text-xs text-[var(--color-text-muted)]">Not tested</span>
      case 'probing':
        return (
          <span className="text-xs text-blue-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mr-1 align-middle" />
            Checking...
          </span>
        )
      case 'ok':
        return <span className="text-xs text-green-500">Connected</span>
      case 'error':
        return <span className="text-xs text-red-500">{errMsg || 'Failed'}</span>
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-lg">
        <h1 className="mb-1 text-center text-2xl font-bold text-[var(--color-text)]">
          Jarvis Setup
        </h1>
        <p className="mb-6 text-center text-sm text-[var(--color-text-muted)]">
          Configure your service URLs to get started. Both services must be running and
          reachable.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="auth-url" className="text-sm text-[var(--color-text-muted)]">
                Auth Service URL
              </label>
              {statusBadge(authStatus, authError)}
            </div>
            <div className="flex gap-2">
              <input
                id="auth-url"
                type="url"
                required
                value={authUrl}
                onChange={(e) => {
                  setAuthUrl(e.target.value)
                  setAuthStatus('idle')
                }}
                className={inputClass}
                placeholder="http://localhost:8007"
              />
              <button
                type="button"
                onClick={handleProbeAuth}
                disabled={authStatus === 'probing'}
                className={cn(
                  'shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm',
                  'hover:bg-[var(--color-surface-alt)] transition-colors',
                  'disabled:opacity-50',
                )}
              >
                Test
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label
                htmlFor="config-url"
                className="text-sm text-[var(--color-text-muted)]"
              >
                Config Service URL
              </label>
              {statusBadge(configStatus, configError)}
            </div>
            <div className="flex gap-2">
              <input
                id="config-url"
                type="url"
                required
                value={configUrl}
                onChange={(e) => {
                  setConfigUrl(e.target.value)
                  setConfigStatus('idle')
                }}
                className={inputClass}
                placeholder="http://localhost:8013"
              />
              <button
                type="button"
                onClick={handleProbeConfig}
                disabled={configStatus === 'probing'}
                className={cn(
                  'shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm',
                  'hover:bg-[var(--color-surface-alt)] transition-colors',
                  'disabled:opacity-50',
                )}
              >
                Test
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!bothHealthy || saving}
            className={cn(
              'w-full rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white',
              'hover:opacity-90 disabled:opacity-50',
              'transition-opacity',
            )}
          >
            {saving ? 'Saving...' : 'Continue to Login'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/login')}
            className="w-full text-center text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Skip (use defaults)
          </button>
        </form>
      </div>
    </div>
  )
}
