export interface HardwareInfo {
  platform: 'darwin' | 'linux'
  arch: string
  totalMemoryGb: number
  gpuName: string | null
  gpuVramMb: number | null
  recommendedBackends: string[]
  recommendedBackend: string
}

export interface WizardState {
  currentStep: number
  totalSteps: number

  // Step 1: Services
  enabledModules: string[]

  // Step 2: Configuration
  portOverrides: Record<string, number>
  infraPortOverrides: Record<string, number>
  secrets: Record<string, string>
  dbUser: string
  whisperModel: string
  llmInterface: string

  // New: deployment mode
  deploymentMode: 'local' | 'remote-llm'
  remoteLlmUrl: string
  remoteWhisperUrl: string
  platform: 'darwin' | 'linux'
  hardware: HardwareInfo | null
}

export interface InstallStatus {
  configured: boolean
  composePath?: string
  reason?: string
}

export interface HealthStatus {
  [serviceId: string]: {
    healthy: boolean
    url: string
    error?: string
  }
}

export interface RegisterResult {
  registered: string[]
  failed: Array<{ serviceId: string; error: string }>
  needsRestart: boolean
}
