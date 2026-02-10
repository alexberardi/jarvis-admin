interface DiscoveryErrorScreenProps {
  error: string
  onRetry: () => void
}

export default function DiscoveryErrorScreen({ error, onRetry }: DiscoveryErrorScreenProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-background)]">
      <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-lg">
        <h1 className="mb-2 text-lg font-bold text-[var(--color-text)]">
          Config Service Not Found
        </h1>
        <p className="mb-6 text-sm text-[var(--color-text-muted)]">{error}</p>
        <button
          onClick={onRetry}
          className="w-full rounded-lg bg-[var(--color-primary)] px-4 py-2 font-medium text-white hover:opacity-90 transition-opacity"
        >
          Retry
        </button>
      </div>
    </div>
  )
}
