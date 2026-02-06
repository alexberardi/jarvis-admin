import { type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

export default function LoginPage() {
  const { state, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (state.isAuthenticated) {
    return <Navigate to="/settings" replace />
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    login(email, password)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
      <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-lg">
        <h1 className="mb-6 text-center text-2xl font-bold text-[var(--color-text)]">
          Jarvis Admin
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-[var(--color-text-muted)]">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(
                'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2',
                'text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
                'outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
              )}
              placeholder="admin@jarvis.local"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-[var(--color-text-muted)]">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(
                'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2',
                'text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
                'outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
              )}
            />
          </div>

          {state.error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={state.isLoading}
            className={cn(
              'w-full rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white',
              'hover:opacity-90 disabled:opacity-50',
              'transition-opacity',
            )}
          >
            {state.isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
