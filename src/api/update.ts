import { apiClient } from './client'

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseUrl: string
  releaseNotes: string
  publishedAt: string
}

export interface UpgradeStatus {
  inProgress: boolean
  phase?: string
  version?: string
  startedAt?: string
}

export async function getUpdateInfo(): Promise<UpdateInfo> {
  const { data } = await apiClient.get<UpdateInfo>('/api/update/check')
  return data
}

export async function forceUpdateCheck(): Promise<UpdateInfo> {
  const { data } = await apiClient.post<UpdateInfo>('/api/update/check')
  return data
}

export async function getUpgradeStatus(): Promise<UpgradeStatus> {
  const { data } = await apiClient.get<UpgradeStatus>('/api/update/status')
  return data
}
