import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getServiceEnv, updateServiceEnv } from '@/api/serviceEnv'
import type { ServiceEnvResponse, ServiceEnvUpdateResponse } from '@/api/serviceEnv'

export function useServiceEnv() {
  return useQuery<ServiceEnvResponse>({
    queryKey: ['service-env'],
    queryFn: getServiceEnv,
    staleTime: 30_000,
  })
}

export function useUpdateServiceEnv() {
  const queryClient = useQueryClient()

  return useMutation<
    ServiceEnvUpdateResponse,
    Error,
    { serviceId: string; values: Record<string, string> }
  >({
    mutationFn: ({ serviceId, values }) => updateServiceEnv(serviceId, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-env'] })
    },
  })
}
