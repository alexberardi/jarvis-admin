import { useState } from 'react'
import { Play, Square, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PipelineStep, BuildConfig, PipelineState, ArtifactsResponse } from '@/types/training'

const ALL_STEPS: { value: PipelineStep; label: string }[] = [
  { value: 'generate', label: 'Generate Data' },
  { value: 'train', label: 'Train Adapter' },
  { value: 'validate', label: 'Validate' },
  { value: 'merge', label: 'Merge' },
  { value: 'convert_gguf', label: 'Convert GGUF' },
  { value: 'convert_mlx', label: 'Convert MLX' },
]

const QUANT_OPTIONS = ['f16', 'Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0']
const OPTIM_OPTIONS = ['adamw_8bit', 'adamw_torch']

interface PipelineFormProps {
  pipelineState: PipelineState
  artifacts: ArtifactsResponse | undefined
  onStart: (steps: PipelineStep[], config: BuildConfig) => void
  onCancel: () => void
  isStarting: boolean
  isCancelling: boolean
}

export default function PipelineForm({
  pipelineState,
  artifacts,
  onStart,
  onCancel,
  isStarting,
  isCancelling,
}: PipelineFormProps) {
  const [selectedSteps, setSelectedSteps] = useState<Set<PipelineStep>>(
    new Set(['generate', 'train', 'validate', 'merge', 'convert_gguf']),
  )

  const baseModels = artifacts?.base_models ?? []
  const defaultModel = baseModels[0]?.path ?? '.models/llama-3.1-8b-instruct'

  const [config, setConfig] = useState<BuildConfig>({
    base_model: defaultModel,
    adapter_dir: 'adapters/jarvis',
    output_name: null,
    epochs: 3,
    batch_size: 4,
    lora_r: 16,
    optim: 'adamw_8bit',
    gguf_quant: 'Q4_K_M',
    mlx_bits: 4,
    formats: ['gguf'],
  })

  const isRunning = pipelineState === 'running'

  function toggleStep(step: PipelineStep) {
    setSelectedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(step)) {
        next.delete(step)
      } else {
        next.add(step)
      }
      return next
    })
  }

  function handleStart() {
    const steps = ALL_STEPS.filter((s) => selectedSteps.has(s.value)).map((s) => s.value)
    if (steps.length === 0) return
    onStart(steps, config)
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Pipeline</h2>

      {/* Step selection */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]">
          Steps
        </label>
        <div className="flex flex-wrap gap-2">
          {ALL_STEPS.map((step) => (
            <button
              key={step.value}
              onClick={() => toggleStep(step.value)}
              disabled={isRunning}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                selectedSteps.has(step.value)
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]',
                isRunning && 'cursor-not-allowed opacity-50',
              )}
            >
              {step.label}
            </button>
          ))}
        </div>
      </div>

      {/* Config fields */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        {/* Base model */}
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
            Base Model
          </label>
          {baseModels.length > 0 ? (
            <select
              value={config.base_model}
              onChange={(e) => setConfig({ ...config, base_model: e.target.value })}
              disabled={isRunning}
              className={cn(
                'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5',
                'text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
              )}
            >
              {baseModels.map((m) => (
                <option key={m.path} value={m.path}>
                  {m.name} ({formatSize(m.size_gb)})
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={config.base_model}
              onChange={(e) => setConfig({ ...config, base_model: e.target.value })}
              disabled={isRunning}
              className={cn(
                'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5',
                'text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
              )}
            />
          )}
        </div>

        <NumberField
          label="Epochs"
          value={config.epochs}
          onChange={(v) => setConfig({ ...config, epochs: v })}
          min={1}
          max={100}
          disabled={isRunning}
        />
        <NumberField
          label="Batch Size"
          value={config.batch_size}
          onChange={(v) => setConfig({ ...config, batch_size: v })}
          min={1}
          max={64}
          disabled={isRunning}
        />
        <NumberField
          label="LoRA Rank"
          value={config.lora_r}
          onChange={(v) => setConfig({ ...config, lora_r: v })}
          min={4}
          max={256}
          disabled={isRunning}
        />

        <SelectField
          label="Optimizer"
          value={config.optim}
          options={OPTIM_OPTIONS}
          onChange={(v) => setConfig({ ...config, optim: v })}
          disabled={isRunning}
        />
        <SelectField
          label="GGUF Quant"
          value={config.gguf_quant}
          options={QUANT_OPTIONS}
          onChange={(v) => setConfig({ ...config, gguf_quant: v })}
          disabled={isRunning}
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {!isRunning ? (
          <button
            onClick={handleStart}
            disabled={isStarting || selectedSteps.size === 0}
            className={cn(
              'flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white',
              'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Start Pipeline
          </button>
        ) : (
          <button
            onClick={onCancel}
            disabled={isCancelling}
            className={cn(
              'flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white',
              'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {isCancelling ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Square size={14} />
            )}
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function formatSize(sizeGb: number | null): string {
  if (sizeGb === null) return '?'
  if (sizeGb < 0.01) return `${Math.round(sizeGb * 1024)} MB`
  return `${sizeGb} GB`
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  disabled: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
        min={min}
        max={max}
        disabled={disabled}
        className={cn(
          'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5',
          'text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
        )}
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
  disabled: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5',
          'text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
        )}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  )
}
