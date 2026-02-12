import { Database, Box, HardDrive, FileText, Cpu } from 'lucide-react'
import type { ArtifactsResponse } from '@/types/training'
import { cn } from '@/lib/utils'

interface ArtifactsCardProps {
  artifacts: ArtifactsResponse
}

function formatSize(sizeGb: number | null): string {
  if (sizeGb === null) return ''
  if (sizeGb < 0.01) return `${Math.round(sizeGb * 1024)} MB`
  return `${sizeGb} GB`
}

export default function ArtifactsCard({ artifacts }: ArtifactsCardProps) {
  const hasAny =
    artifacts.base_models.length > 0 ||
    artifacts.adapters.length > 0 ||
    artifacts.merged_models.length > 0 ||
    artifacts.gguf_models.length > 0 ||
    artifacts.mlx_models.length > 0 ||
    artifacts.training_data

  return (
    <div
      className={cn(
        'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4',
      )}
    >
      <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Artifacts</h2>

      {!hasAny && (
        <p className="text-sm text-[var(--color-text-muted)]">
          No artifacts found on disk.
        </p>
      )}

      <div className="space-y-2">
        {artifacts.base_models.map((m) => (
          <ArtifactRow
            key={m.path}
            icon={<Database size={14} />}
            label="Base Model"
            name={m.name}
            detail={formatSize(m.size_gb)}
          />
        ))}

        {artifacts.adapters.map((a) => (
          <ArtifactRow
            key={a.path}
            icon={<Cpu size={14} />}
            label="Adapter"
            name={a.name}
            detail={a.has_config ? 'trained' : 'incomplete'}
          />
        ))}

        {artifacts.training_data && (
          <ArtifactRow
            icon={<FileText size={14} />}
            label="Training Data"
            name={`${artifacts.training_data.num_examples.toLocaleString()} examples`}
            detail={`${artifacts.training_data.size_kb} KB`}
          />
        )}

        {artifacts.merged_models.map((m) => (
          <ArtifactRow
            key={m.path}
            icon={<Box size={14} />}
            label="Merged"
            name={m.name}
            detail={formatSize(m.size_gb)}
          />
        ))}

        {artifacts.gguf_models.map((m) => (
          <ArtifactRow
            key={m.path}
            icon={<HardDrive size={14} />}
            label="GGUF"
            name={m.name}
            detail={formatSize(m.size_gb)}
          />
        ))}

        {artifacts.mlx_models.map((m) => (
          <ArtifactRow
            key={m.path}
            icon={<HardDrive size={14} />}
            label="MLX"
            name={m.name}
            detail={formatSize(m.size_gb)}
          />
        ))}
      </div>
    </div>
  )
}

function ArtifactRow({
  icon,
  label,
  name,
  detail,
}: {
  icon: React.ReactNode
  label: string
  name: string
  detail: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-[var(--color-surface-alt)] px-3 py-2 text-sm">
      <span className="text-[var(--color-text-muted)]">{icon}</span>
      <span className="font-medium text-[var(--color-text-muted)]">{label}</span>
      <span className="flex-1 truncate text-[var(--color-text)]">{name}</span>
      {detail && (
        <span className="text-xs text-[var(--color-text-muted)]">{detail}</span>
      )}
    </div>
  )
}
