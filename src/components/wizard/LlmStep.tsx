import { useState } from 'react'
import { Download, CheckCircle2, AlertTriangle, Loader2, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWizard } from '@/context/WizardContext'
import { LLM_MODELS, type LlmModel } from '@/data/models'
import { useConfigureLlm, useDownloadModel } from '@/hooks/useLlmSetup'

type Phase = 'select' | 'token' | 'downloading' | 'configuring' | 'done'

export default function LlmStep() {
  const { state, dispatch } = useWizard()
  const configureMutation = useConfigureLlm()
  const downloadMutation = useDownloadModel()

  const [phase, setPhase] = useState<Phase>('select')
  const [selectedModel, setSelectedModel] = useState<LlmModel | null>(null)
  const [backend, setBackend] = useState<'GGUF' | 'VLLM'>('GGUF')
  const [hfToken, setHfToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Remote LLM mode — already configured
  if (state.deploymentMode === 'remote-llm') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-text)]">LLM Configuration</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Your LLM is configured to use a remote server.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
          <CheckCircle2 size={20} className="text-green-500" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">Remote LLM configured</p>
            <p className="text-xs text-[var(--color-text-muted)]">{state.remoteLlmUrl}</p>
          </div>
        </div>
      </div>
    )
  }

  // macOS native — can't download into Docker, skip
  if (state.platform === 'darwin') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-text)]">LLM Configuration</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            On macOS, the LLM proxy runs natively to access Metal/MLX. Configure it from the
            dashboard after setup, or run it directly from the jarvis-llm-proxy-api directory.
          </p>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-500">
          macOS native LLM proxy is not yet available as a pip package. Model download through
          this wizard requires the LLM proxy running in Docker.
        </div>
      </div>
    )
  }

  const handleModelSelect = (model: LlmModel) => {
    setSelectedModel(model)
    setError(null)
    if (model.gated && !hfToken.trim()) {
      // Gated model and no token entered yet — prompt for it
      setPhase('token')
    } else {
      // Non-gated or token already provided — download directly
      handleDownload(model, hfToken.trim())
    }
  }

  const handleTokenSubmit = () => {
    if (!hfToken.trim()) {
      setError('HuggingFace token is required for gated models')
      return
    }
    if (selectedModel) {
      handleDownload(selectedModel, hfToken)
    }
  }

  const handleDownload = async (model: LlmModel, token: string) => {
    setPhase('downloading')
    setError(null)

    const repo = backend === 'GGUF' ? model.hfRepoGguf : model.hfRepoVllm
    const filename = backend === 'GGUF' ? model.ggufFilename : undefined

    try {
      await downloadMutation.mutateAsync({ repo, filename, token: token || undefined })
      await handleConfigure(model)
    } catch (err) {
      setError(`Download failed: ${(err as Error).message}`)
      setPhase('select')
    }
  }

  const handleConfigure = async (model: LlmModel) => {
    setPhase('configuring')

    const modelPath = backend === 'GGUF'
      ? `.models/${model.ggufFilename}`
      : `.models/${model.hfRepoVllm.split('/').pop()}`

    const settings: Record<string, unknown> = {
      'model.main.name': modelPath,
      'model.main.backend': backend,
      'model.main.chat_format': model.chatFormat,
      'model.main.context_window': model.contextWindow,
      'llm.interface': model.promptProvider,
    }

    if (backend === 'GGUF') {
      settings['inference.gguf.n_gpu_layers'] = -1
    }
    if (backend === 'VLLM' && model.quantization) {
      settings['inference.vllm.quantization'] = model.quantization
    }

    try {
      await configureMutation.mutateAsync(settings)
      // Update wizard state so ReviewStep knows the interface
      dispatch({ type: 'SET_LLM_INTERFACE', interfaceId: model.promptProvider })
      setPhase('done')
    } catch (err) {
      setError(`Configuration failed: ${(err as Error).message}`)
      setPhase('select')
    }
  }

  // Filter models by available VRAM
  const vram = state.hardware?.gpuVramMb
  const filteredModels = vram
    ? LLM_MODELS.filter((m) => m.vramMb <= vram)
    : LLM_MODELS

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--color-text)]">LLM Setup</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {phase === 'done'
            ? 'Model configured. The LLM proxy is restarting with the new model.'
            : 'Select and download a language model for Jarvis.'}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Select model */}
      {phase === 'select' && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--color-text)]">Backend</span>
            <div className="flex gap-2">
              {(['GGUF', 'VLLM'] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBackend(b)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    backend === b
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
                  )}
                >
                  {b === 'VLLM' ? 'vLLM' : b}
                </button>
              ))}
            </div>
          </div>

          {/* Optional HF token for authenticated downloads */}
          <div>
            <label htmlFor="hf-token" className="mb-1 block text-xs text-[var(--color-text-muted)]">
              HuggingFace Token (optional — speeds up downloads, required for gated models)
            </label>
            <input
              id="hf-token"
              type="password"
              value={hfToken}
              onChange={(e) => setHfToken(e.target.value)}
              placeholder="hf_..."
              className={cn(
                'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2',
                'text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
                'outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
              )}
            />
          </div>

          <div className="space-y-2">
            {filteredModels.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => handleModelSelect(model)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] p-3 text-left transition-colors',
                  'hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-alt)]',
                )}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {model.displayName}
                    </span>
                    {model.gated && (
                      <span className="flex items-center gap-0.5 rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
                        <Lock size={10} />
                        Gated
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {model.promptProvider} &middot; {model.contextWindow.toLocaleString()} ctx
                  </p>
                </div>
                <span className="text-xs text-[var(--color-text-muted)]">
                  ~{backend === 'GGUF' ? model.sizeGguf : model.sizeVllm}
                </span>
              </button>
            ))}

            {filteredModels.length === 0 && (
              <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
                No models fit your available VRAM ({vram ? Math.round(vram / 1024) + ' GB' : 'unknown'}).
                Consider using Remote LLM mode.
              </p>
            )}

            {vram && filteredModels.length < LLM_MODELS.length && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Showing {filteredModels.length} of {LLM_MODELS.length} models that fit your {Math.round(vram / 1024)} GB VRAM.
              </p>
            )}
          </div>
        </>
      )}

      {/* HuggingFace token */}
      {phase === 'token' && selectedModel && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            <strong>{selectedModel.displayName}</strong> is a gated model. Accept the license on
            HuggingFace and paste your access token below.
          </p>
          <input
            type="password"
            value={hfToken}
            onChange={(e) => setHfToken(e.target.value)}
            placeholder="hf_..."
            className={cn(
              'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-3 py-2',
              'text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]',
              'outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
            )}
          />
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => { setPhase('select'); setError(null) }}
              className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleTokenSubmit}
              className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm text-white hover:opacity-90"
            >
              Download
            </button>
          </div>
        </div>
      )}

      {/* Downloading */}
      {phase === 'downloading' && (
        <div className="flex flex-col items-center py-8">
          <Download className="mb-4 animate-bounce text-[var(--color-primary)]" size={32} />
          <p className="text-sm font-medium text-[var(--color-text)]">
            Downloading {selectedModel?.displayName}...
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            ~{backend === 'GGUF' ? selectedModel?.sizeGguf : selectedModel?.sizeVllm} &middot; This may take several minutes
          </p>
        </div>
      )}

      {/* Configuring */}
      {phase === 'configuring' && (
        <div className="flex flex-col items-center py-8">
          <Loader2 className="mb-4 animate-spin text-[var(--color-primary)]" size={32} />
          <p className="text-sm font-medium text-[var(--color-text)]">
            Configuring model and prompt provider...
          </p>
        </div>
      )}

      {/* Done */}
      {phase === 'done' && selectedModel && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
            <CheckCircle2 size={20} className="text-green-500" />
            <div>
              <p className="text-sm font-medium text-[var(--color-text)]">
                {selectedModel.displayName} configured
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Backend: {backend} &middot; Prompt provider: {selectedModel.promptProvider}
              </p>
            </div>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            The LLM proxy is restarting with the new model. It may take a minute to load.
            Command Center will automatically use the <strong>{selectedModel.promptProvider}</strong> prompt
            provider for optimized command parsing.
          </p>
        </div>
      )}
    </div>
  )
}
