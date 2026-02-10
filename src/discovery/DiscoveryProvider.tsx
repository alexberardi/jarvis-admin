import { useEffect, useState, type ReactNode } from 'react'
import { configureClients } from '@/api/client'
import { discover } from './discoveryService'
import DiscoveryLoadingScreen from './DiscoveryLoadingScreen'
import DiscoveryErrorScreen from './DiscoveryErrorScreen'

type DiscoveryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' }

export default function DiscoveryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DiscoveryState>({ status: 'loading' })
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    setState({ status: 'loading' })

    discover()
      .then(({ authUrl, settingsUrl }) => {
        if (cancelled) return
        configureClients(authUrl, settingsUrl)
        setState({ status: 'ready' })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Unknown discovery error'
        setState({ status: 'error', message })
      })

    return () => {
      cancelled = true
    }
  }, [retryCount])

  if (state.status === 'loading') {
    return <DiscoveryLoadingScreen />
  }

  if (state.status === 'error') {
    return (
      <DiscoveryErrorScreen
        error={state.message}
        onRetry={() => setRetryCount((c) => c + 1)}
      />
    )
  }

  return <>{children}</>
}
