import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getServiceRegistry, registerServices, rotateServiceKey } from '@/api/services'
import type {
  ServiceRegisterRequest,
  ServiceRegisterResponse,
  KeyRotateRequest,
  KeyRotateResponse,
} from '@/types/services'

export function useServiceRegistry() {
  return useQuery({
    queryKey: ['service-registry'],
    queryFn: getServiceRegistry,
    staleTime: 30_000,
  })
}

export function useRegisterServices() {
  const queryClient = useQueryClient()

  return useMutation<ServiceRegisterResponse, Error, ServiceRegisterRequest>({
    mutationFn: registerServices,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-registry'] })
    },
  })
}

export function useRotateKey() {
  const queryClient = useQueryClient()

  return useMutation<KeyRotateResponse, Error, KeyRotateRequest>({
    mutationFn: rotateServiceKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-registry'] })
    },
  })
}

