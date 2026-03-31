import { useEffect, useState } from 'react'
import { Cpu, HardDrive, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWizard } from '@/context/WizardContext'
import { getHardwareInfo } from '@/api/install'
import type { HardwareInfo } from '@/types/wizard'

const GPU_OPTIONS = [
  { label: 'None / CPU only', gpu: null, vramMb: null, backends: ['gguf'], defaultBackend: 'gguf' },
  // NVIDIA
  { label: 'NVIDIA RTX 4090 (24 GB)', gpu: 'NVIDIA RTX 4090', vramMb: 24576, backends: ['gguf', 'vllm'], defaultBackend: 'gguf' },
  { label: 'NVIDIA RTX 4080 (16 GB)', gpu: 'NVIDIA RTX 4080', vramMb: 16384, backends: ['gguf', 'vllm'], defaultBackend: 'gguf' },
  { label: 'NVIDIA RTX 4070 Ti (12 GB)', gpu: 'NVIDIA RTX 4070 Ti', vramMb: 12288, backends: ['gguf', 'vllm'], defaultBackend: 'gguf' },
  { label: 'NVIDIA RTX 3090 (24 GB)', gpu: 'NVIDIA RTX 3090', vramMb: 24576, backends: ['gguf', 'vllm'], defaultBackend: 'gguf' },
  { label: 'NVIDIA RTX 3080 (10 GB)', gpu: 'NVIDIA RTX 3080', vramMb: 10240, backends: ['gguf', 'vllm'], defaultBackend: 'gguf' },
  { label: 'NVIDIA RTX 3070 (8 GB)', gpu: 'NVIDIA RTX 3070', vramMb: 8192, backends: ['gguf', 'vllm'], defaultBackend: 'gguf' },
  { label: 'NVIDIA A100 (80 GB)', gpu: 'NVIDIA A100', vramMb: 81920, backends: ['gguf', 'vllm'], defaultBackend: 'vllm' },
  { label: 'NVIDIA A100 (40 GB)', gpu: 'NVIDIA A100', vramMb: 40960, backends: ['gguf', 'vllm'], defaultBackend: 'vllm' },
  { label: 'NVIDIA Tesla T4 (16 GB)', gpu: 'NVIDIA Tesla T4', vramMb: 16384, backends: ['gguf', 'vllm'], defaultBackend: 'gguf' },
  // AMD
  { label: 'AMD RX 7900 XTX (24 GB)', gpu: 'AMD RX 7900 XTX', vramMb: 24576, backends: ['gguf'], defaultBackend: 'gguf' },
  { label: 'AMD RX 7900 XT (20 GB)', gpu: 'AMD RX 7900 XT', vramMb: 20480, backends: ['gguf'], defaultBackend: 'gguf' },
  { label: 'AMD RX 7800 XT (16 GB)', gpu: 'AMD RX 7800 XT', vramMb: 16384, backends: ['gguf'], defaultBackend: 'gguf' },
  // Apple Silicon
  { label: 'Apple M4 Max (128 GB unified)', gpu: 'Apple M4 Max', vramMb: 131072, backends: ['gguf', 'mlx'], defaultBackend: 'gguf' },
  { label: 'Apple M4 Max (64 GB unified)', gpu: 'Apple M4 Max', vramMb: 65536, backends: ['gguf', 'mlx'], defaultBackend: 'gguf' },
  { label: 'Apple M4 Pro (48 GB unified)', gpu: 'Apple M4 Pro', vramMb: 49152, backends: ['gguf', 'mlx'], defaultBackend: 'gguf' },
  { label: 'Apple M4 Pro (24 GB unified)', gpu: 'Apple M4 Pro', vramMb: 24576, backends: ['gguf', 'mlx'], defaultBackend: 'gguf' },
  { label: 'Apple M2 Max (32 GB unified)', gpu: 'Apple M2 Max', vramMb: 32768, backends: ['gguf', 'mlx'], defaultBackend: 'gguf' },
  { label: 'Apple M2 Pro (16 GB unified)', gpu: 'Apple M2 Pro', vramMb: 16384, backends: ['gguf', 'mlx'], defaultBackend: 'gguf' },
  { label: 'Apple M1 (16 GB unified)', gpu: 'Apple M1', vramMb: 16384, backends: ['gguf', 'mlx'], defaultBackend: 'gguf' },
  { label: 'Apple M1 (8 GB unified)', gpu: 'Apple M1', vramMb: 8192, backends: ['gguf', 'mlx'], defaultBackend: 'gguf' },
  // Custom
  { label: 'Other (enter VRAM manually)', gpu: 'Other', vramMb: null, backends: ['gguf'], defaultBackend: 'gguf' },
] as const

export default function HardwareStep() {
  const { state, dispatch } = useWizard()
  const [loading, setLoading] = useState(!state.hardware)
  const [showManualGpu, setShowManualGpu] = useState(false)
  const [selectedGpuIdx, setSelectedGpuIdx] = useState(0)
  const [customVram, setCustomVram] = useState('')

  useEffect(() => {
    if (state.hardware) return
    getHardwareInfo()
      .then((hw) => {
        dispatch({ type: 'SET_HARDWARE', hardware: hw })
        // Auto-suggest remote-llm for ARM Linux without GPU
        if (hw.recommendedBackend === 'remote' && state.deploymentMode === 'local') {
          dispatch({ type: 'SET_DEPLOYMENT_MODE', mode: 'remote-llm' })
        }
      })
      .catch(() => {
        // Fallback: assume Linux with no GPU
      })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function applyManualGpu(idx: number, vramOverride?: string) {
    const opt = GPU_OPTIONS[idx]
    if (!state.hardware) return

    const vramMb = opt.gpu === 'Other'
      ? (parseInt(vramOverride ?? customVram, 10) || 0) * 1024
      : opt.vramMb

    const updated: HardwareInfo = {
      ...state.hardware,
      gpuName: opt.gpu,
      gpuVramMb: vramMb || null,
      recommendedBackends: opt.backends as unknown as string[],
      recommendedBackend: opt.defaultBackend,
    }
    dispatch({ type: 'SET_HARDWARE', hardware: updated })
  }

  const hw = state.hardware

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 size={32} className="animate-spin text-[var(--color-primary)]" />
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">Detecting hardware...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--color-text)]">Hardware Detection</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          We detected the following hardware. This determines which LLM backend to use.
        </p>
      </div>

      {hw && (
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
            <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
              <Cpu size={16} />
              <span className="text-xs font-medium uppercase">Platform</span>
            </div>
            <p className="mt-1 text-sm font-medium text-[var(--color-text)]">
              {hw.platform === 'darwin' ? 'macOS' : 'Linux'} ({hw.arch})
            </p>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
            <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
              <HardDrive size={16} />
              <span className="text-xs font-medium uppercase">Memory</span>
            </div>
            <p className="mt-1 text-sm font-medium text-[var(--color-text)]">
              {hw.totalMemoryGb} GB RAM
            </p>
          </div>

          <div className="col-span-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <Cpu size={16} />
                  <span className="text-xs font-medium uppercase">GPU</span>
                </div>
                <p className="mt-1 text-sm font-medium text-[var(--color-text)]">
                  {hw.gpuName ?? 'No GPU detected'}
                </p>
                {hw.gpuVramMb != null && hw.gpuVramMb > 0 && (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {Math.round(hw.gpuVramMb / 1024)} GB VRAM
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowManualGpu(!showManualGpu)}
                className="text-xs font-medium text-[var(--color-primary)] hover:underline"
              >
                {showManualGpu ? 'Cancel' : 'Override'}
              </button>
            </div>

            {showManualGpu && (
              <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
                <div>
                  <label htmlFor="gpu-select" className="mb-1 block text-xs text-[var(--color-text-muted)]">
                    Select GPU
                  </label>
                  <select
                    id="gpu-select"
                    value={selectedGpuIdx}
                    onChange={(e) => {
                      const idx = parseInt(e.target.value, 10)
                      setSelectedGpuIdx(idx)
                      const opt = GPU_OPTIONS[idx]
                      if (opt.gpu !== 'Other') {
                        applyManualGpu(idx)
                        setShowManualGpu(false)
                      }
                    }}
                    className={cn(
                      'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2',
                      'text-sm text-[var(--color-text)]',
                      'outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
                    )}
                  >
                    {GPU_OPTIONS.map((opt, i) => (
                      <option key={`${opt.label}-${i}`} value={i}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {GPU_OPTIONS[selectedGpuIdx].gpu === 'Other' && (
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label htmlFor="custom-vram" className="mb-1 block text-xs text-[var(--color-text-muted)]">
                        VRAM (GB)
                      </label>
                      <input
                        id="custom-vram"
                        type="number"
                        min={1}
                        max={512}
                        value={customVram}
                        onChange={(e) => setCustomVram(e.target.value)}
                        placeholder="e.g. 24"
                        className={cn(
                          'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2',
                          'text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
                          'outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
                        )}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!customVram || parseInt(customVram, 10) <= 0}
                      onClick={() => {
                        applyManualGpu(selectedGpuIdx, customVram)
                        setShowManualGpu(false)
                      }}
                      className={cn(
                        'rounded-lg px-4 py-2 text-sm font-medium',
                        'bg-[var(--color-primary)] text-white',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="col-span-2 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 p-4">
            <p className="text-sm font-medium text-[var(--color-text)]">
              Recommended: <span className="text-[var(--color-primary)]">{hw.recommendedBackend.toUpperCase()}</span>
            </p>
            {hw.recommendedBackends.length > 1 && (
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                Available backends: {hw.recommendedBackends.join(', ')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Remote LLM config */}
      {state.deploymentMode === 'remote-llm' && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-[var(--color-text)]">Remote Service URLs</h3>
          <div>
            <label htmlFor="remote-llm" className="mb-1 block text-xs text-[var(--color-text-muted)]">
              LLM Proxy URL
            </label>
            <input
              id="remote-llm"
              type="url"
              value={state.remoteLlmUrl}
              onChange={(e) => dispatch({ type: 'SET_REMOTE_LLM_URL', url: e.target.value })}
              placeholder="http://192.168.1.100:7704"
              className={cn(
                'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2',
                'text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
                'outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
              )}
            />
          </div>
          <div>
            <label htmlFor="remote-whisper" className="mb-1 block text-xs text-[var(--color-text-muted)]">
              Whisper URL (optional)
            </label>
            <input
              id="remote-whisper"
              type="url"
              value={state.remoteWhisperUrl}
              onChange={(e) => dispatch({ type: 'SET_REMOTE_WHISPER_URL', url: e.target.value })}
              placeholder="http://192.168.1.100:7706"
              className={cn(
                'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2',
                'text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
                'outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
              )}
            />
          </div>
        </div>
      )}
    </div>
  )
}
