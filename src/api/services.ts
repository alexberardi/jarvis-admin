import { apiClient } from './client'
import type {
  ServiceRegistryResponse,
  ServiceRegisterRequest,
  ServiceRegisterResponse,
  KeyRotateRequest,
  KeyRotateResponse,
  HealthProbeRequest,
  HealthProbeResponse,
} from '@/types/services'

export async function getServiceRegistry(): Promise<ServiceRegistryResponse> {
  const { data } = await apiClient.get<ServiceRegistryResponse>('/api/services/registry')
  return data
}

export async function registerServices(
  request: ServiceRegisterRequest,
): Promise<ServiceRegisterResponse> {
  const { data } = await apiClient.post<ServiceRegisterResponse>(
    '/api/services/register',
    request,
  )
  return data
}

export async function rotateServiceKey(
  request: KeyRotateRequest,
): Promise<KeyRotateResponse> {
  const { data } = await apiClient.post<KeyRotateResponse>(
    '/api/services/rotate-key',
    request,
  )
  return data
}

export async function probeServiceHealth(
  request: HealthProbeRequest,
): Promise<HealthProbeResponse> {
  const { data } = await apiClient.post<HealthProbeResponse>(
    '/api/services/probe',
    request,
  )
  return data
}
