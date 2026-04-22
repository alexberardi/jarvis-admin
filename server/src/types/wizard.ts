export type GpuType = 'nvidia' | 'amd' | 'amd-rocm' | 'apple' | 'none'

export interface HardwareInfo {
  platform: 'darwin' | 'linux'
  arch: string
  totalMemoryGb: number
  gpuName: string | null
  gpuVramMb: number | null
  gpuType: GpuType
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
  deploymentTarget: 'standard' | 'compose-export'
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
  appKeys?: Record<string, { appId: string; appKey: string }>
}

export interface ServiceHealthResult {
  healthy: boolean
  error?: string
}

export interface TieredStartupResult {
  success: boolean
  error?: string
  serviceHealth?: Record<string, ServiceHealthResult>
}

export interface PreflightCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  details?: string
}

export interface PreflightResult {
  checks: PreflightCheck[]
  canProceed: boolean
}

export interface InstallState {
  configured: boolean
  composePath?: string
  reason?: string
  state?: 'fresh' | 'generated' | 'partial' | 'running' | 'complete' | 'deployed-needs-account'
  running?: string[]
  stopped?: string[]
  deployMode?: 'standard' | 'compose-export'
}
