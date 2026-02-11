export interface ModuleInfo {
  id: string
  name: string
  description: string
  port: number
  profile: string
  dependsOn: string[]
  enabled: boolean
}

export interface ModulesResponse {
  modules: ModuleInfo[]
  error?: string
}

export interface ModuleActionResponse {
  success: boolean
  message: string
  error?: string
  dependents?: string[]
}
