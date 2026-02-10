import { settingsClient } from './client'
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
  const { data } = await settingsClient.get<ServiceRegistryResponse>('/v1/services/registry')
  return data
}

export async function registerServices(
  request: ServiceRegisterRequest,
): Promise<ServiceRegisterResponse> {
  const { data } = await settingsClient.post<ServiceRegisterResponse>(
    '/v1/services/register',
    request,
  )
  return data
}

export async function rotateServiceKey(
  request: KeyRotateRequest,
): Promise<KeyRotateResponse> {
  const { data } = await settingsClient.post<KeyRotateResponse>(
    '/v1/services/rotate-key',
    request,
  )
  return data
}

export async function probeServiceHealth(
  request: HealthProbeRequest,
): Promise<HealthProbeResponse> {
  const { data } = await settingsClient.post<HealthProbeResponse>(
    '/v1/services/probe',
    request,
  )
  return data
}
