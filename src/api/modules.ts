import { apiClient } from './client'
import type { ModulesResponse, ModuleActionResponse } from '@/types/modules'

export async function getModules(): Promise<ModulesResponse> {
  const { data } = await apiClient.get<ModulesResponse>('/api/modules')
  return data
}

export async function enableModule(id: string): Promise<ModuleActionResponse> {
  const { data } = await apiClient.post<ModuleActionResponse>(`/api/modules/${id}/enable`)
  return data
}

export async function disableModule(id: string): Promise<ModuleActionResponse> {
  const { data } = await apiClient.post<ModuleActionResponse>(`/api/modules/${id}/disable`)
  return data
}
