import { useEffect, useState } from 'react'
import { Cpu, HardDrive, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWizard } from '@/context/WizardContext'
import { getHardwareInfo } from '@/api/install'

export default function HardwareStep() {
  const { state, dispatch } = useWizard()
  const [loading, setLoading] = useState(!state.hardware)

  useEffect(() => {
    if (state.hardware) return
    setLoading(true)
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
            <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
              <Cpu size={16} />
              <span className="text-xs font-medium uppercase">GPU</span>
            </div>
            <p className="mt-1 text-sm font-medium text-[var(--color-text)]">
              {hw.gpuName ?? 'No GPU detected'}
            </p>
            {hw.gpuVramMb && (
              <p className="text-xs text-[var(--color-text-muted)]">
                {Math.round(hw.gpuVramMb / 1024)} GB VRAM
              </p>
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
