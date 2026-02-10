export default function DiscoveryLoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-background)]">
      <div className="h-8 w-8 animate-spin rounded-full border-3 border-[var(--color-border)] border-t-[var(--color-primary)]" />
      <p className="text-sm text-[var(--color-text-muted)]">
        Scanning network for config service...
      </p>
    </div>
  )
}
