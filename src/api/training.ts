import { apiClient } from './client'
import type { PipelineStatus, BuildRequest, ArtifactsResponse } from '@/types/training'

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const { data } = await apiClient.get<PipelineStatus>('/api/training/status')
  return data
}

export async function startBuild(request: BuildRequest): Promise<PipelineStatus> {
  const { data } = await apiClient.post<PipelineStatus>('/api/training/build', request)
  return data
}

export async function cancelBuild(): Promise<PipelineStatus> {
  const { data } = await apiClient.post<PipelineStatus>('/api/training/cancel')
  return data
}

export async function getArtifacts(): Promise<ArtifactsResponse> {
  const { data } = await apiClient.get<ArtifactsResponse>('/api/training/artifacts')
  return data
}
