import { cn } from '@/lib/utils'
import type { ModuleInfo } from '@/types/modules'

interface ModuleToggleCardProps {
  module: ModuleInfo
  onToggle: (id: string, enable: boolean) => void
  isToggling: boolean
}

export default function ModuleToggleCard({
  module,
  onToggle,
  isToggling,
}: ModuleToggleCardProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text)]">{module.name}</p>
          <p className="text-xs text-[var(--color-text-muted)]">{module.description}</p>
        </div>

        <button
          onClick={() => onToggle(module.id, !module.enabled)}
          disabled={isToggling}
          className={cn(
            'relative h-6 w-11 rounded-full transition-colors',
            module.enabled
              ? 'bg-[var(--color-secondary)]'
              : 'bg-[var(--color-border)]',
            isToggling && 'opacity-50',
          )}
          role="switch"
          aria-checked={module.enabled}
          title={module.enabled ? 'Disable' : 'Enable'}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
              module.enabled ? 'translate-x-5.5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      <div className="border-t border-[var(--color-border)] px-4 py-2">
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span>Port {module.port}</span>
          {module.dependsOn.length > 0 && (
            <span>Depends on: {module.dependsOn.join(', ')}</span>
          )}
          <span
            className={cn(
              'ml-auto rounded-full px-2 py-0.5 font-medium',
              module.enabled
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-gray-500/10 text-gray-500',
            )}
          >
            {module.enabled ? 'enabled' : 'disabled'}
          </span>
        </div>
      </div>
    </div>
  )
}
