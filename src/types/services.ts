export interface KnownServiceEntry {
  name: string
  default_port: number
  description: string
  health_path: string
  config_registered: boolean
  auth_registered: boolean
  current_host: string | null
  current_port: number | null
}

export interface ServiceRegistryResponse {
  services: KnownServiceEntry[]
}

export interface ServiceRegisterItem {
  name: string
  host: string
  port: number
}

export interface ServiceRegisterRequest {
  services: ServiceRegisterItem[]
  base_path?: string | null
}

export interface ServiceRegisterResult {
  name: string
  config_ok: boolean
  auth_ok: boolean
  auth_created: boolean
  app_key: string | null
  env_written: boolean | null
  error: string | null
}

export interface ServiceRegisterResponse {
  results: ServiceRegisterResult[]
}

export interface HealthProbeRequest {
  host: string
  port: number
  health_path?: string
  scheme?: string
}

export interface HealthProbeResponse {
  healthy: boolean
  latency_ms: number | null
  error: string | null
}

export interface KeyRotateRequest {
  service_name: string
  base_path?: string | null
}

export interface KeyRotateResponse {
  service_name: string
  app_key: string
  env_written: boolean | null
}
