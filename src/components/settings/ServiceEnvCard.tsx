import { useState, useCallback } from 'react'
import { ChevronDown, ChevronRight, KeyRound, CheckCircle2, CircleDashed } from 'lucide-react'
import { toast } from 'sonner'
import { useUpdateServiceEnv } from '@/hooks/useServiceEnv'
import { useRestartContainer } from '@/hooks/useContainers'
import type { ServiceEnvEntry } from '@/api/serviceEnv'

interface ServiceEnvCardProps {
  entry: ServiceEnvEntry
}

/**
 * Per-service credentials editor: registry-declared, user-supplied env vars
 * written to the stack .env. Secrets are write-only (masked input, set/not-set
 * badge, never echoed). On save, offers a container restart via the same
 * toast-action pattern the settings rows use.
 */
export default function ServiceEnvCard({ entry }: ServiceEnvCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const mutation = useUpdateServiceEnv()
  const restartMutation = useRestartContainer()

  const editableVars = entry.vars.filter((v) => v.user_supplied)
  const dirty = Object.keys(draft).length > 0

  const handleRestart = useCallback(() => {
    if (!entry.container_id) {
      toast.error(`Could not find container for ${entry.service_name}`)
      return
    }
    restartMutation.mutate(entry.container_id, {
      onSuccess: () => toast.success(`${entry.service_name} is restarting...`),
      onError: (err) => toast.error(`Restart failed: ${err.message}`),
    })
  }, [entry.container_id, entry.service_name, restartMutation])

  const handleSave = () => {
    mutation.mutate(
      { serviceId: entry.service_id, values: draft },
      {
        onSuccess: (res) => {
          setDraft({})
          if (res.restart_required) {
            toast.warning(
              `Credentials saved. ${entry.service_name} requires a restart to apply.`,
              {
                action: {
                  label: 'Restart',
                  onClick: handleRestart,
                },
              },
            )
          } else {
            toast.success('Credentials saved')
          }
        },
        onError: (err) => toast.error(`Failed to save: ${err.message}`),
      },
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-alt)]"
      >
        {expanded ? (
          <ChevronDown size={18} className="text-[var(--color-text-muted)]" />
        ) : (
          <ChevronRight size={18} className="text-[var(--color-text-muted)]" />
        )}
        <KeyRound size={16} className="text-[var(--color-tertiary)]" />
        <span className="font-medium text-[var(--color-text)]">{entry.service_name}</span>
        <span className="text-xs text-[var(--color-text-muted)]">
          {editableVars.filter((v) => v.is_set).length}/{editableVars.length} set
        </span>
      </button>

      {expanded && !entry.env_file_exists && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            This service isn't installed yet — its credentials are configured during
            install (wizard) or when you add it via Sync Compose. Once installed,
            set them here.
          </p>
        </div>
      )}

      {expanded && entry.env_file_exists && (
        <div className="space-y-3 border-t border-[var(--color-border)] px-4 py-3">
          {editableVars.map((v) => (
            <div key={v.name}>
              <div className="flex items-center gap-2">
                <code className="text-sm font-medium text-[var(--color-text)]">{v.name}</code>
                {v.secret && (
                  <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-500">
                    secret
                  </span>
                )}
                {v.is_set ? (
                  <span
                    title="Set in .env"
                    className="flex items-center gap-1 text-[10px] text-[var(--color-secondary)]"
                  >
                    <CheckCircle2 size={12} /> set
                  </span>
                ) : (
                  <span
                    title="Not set"
                    className="flex items-center gap-1 text-[10px] text-amber-500"
                  >
                    <CircleDashed size={12} /> not set
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{v.description}</p>
              <input
                type={v.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={
                  v.secret
                    ? v.is_set
                      ? '••••••••  (write-only — enter a new value to replace)'
                      : 'Paste value'
                    : undefined
                }
                value={draft[v.name] ?? (v.secret ? '' : (v.value ?? ''))}
                onChange={(e) => setDraft((d) => ({ ...d, [v.name]: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-1.5 font-mono text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
              />
            </div>
          ))}

          <div className="flex justify-end pt-1">
            <button
              onClick={handleSave}
              disabled={!dirty || mutation.isPending}
              className="rounded-lg bg-[var(--color-primary)] px-4 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-40"
            >
              {mutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
