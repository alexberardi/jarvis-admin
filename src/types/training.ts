export type PipelineStep =
  | 'generate'
  | 'train'
  | 'validate'
  | 'merge'
  | 'convert_gguf'
  | 'convert_mlx'

export type PipelineState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface StepStatus {
  step: PipelineStep
  state: PipelineState
  started_at: string | null
  finished_at: string | null
  error: string | null
}

export interface PipelineStatus {
  state: PipelineState
  current_step: PipelineStep | null
  steps: StepStatus[]
  started_at: string | null
  finished_at: string | null
  error: string | null
}

export interface BuildConfig {
  base_model: string
  adapter_dir: string
  output_name: string | null
  epochs: number
  batch_size: number
  lora_r: number
  optim: string
  gguf_quant: string
  mlx_bits: number
  formats: string[]
}

export interface BuildRequest {
  steps: PipelineStep[]
  config: BuildConfig
}

export interface ArtifactInfo {
  name: string
  path: string
  size_gb: number | null
}

export interface AdapterInfo {
  name: string
  path: string
  has_config: boolean
}

export interface TrainingDataInfo {
  path: string
  num_examples: number
  size_kb: number
}

export interface ArtifactsResponse {
  base_models: ArtifactInfo[]
  adapters: AdapterInfo[]
  merged_models: ArtifactInfo[]
  gguf_models: ArtifactInfo[]
  mlx_models: ArtifactInfo[]
  training_data: TrainingDataInfo | null
}
