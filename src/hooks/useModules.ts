import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getModules, enableModule, disableModule } from '@/api/modules'
import type { ModulesResponse, ModuleActionResponse } from '@/types/modules'

export function useModules() {
  return useQuery<ModulesResponse>({
    queryKey: ['modules'],
    queryFn: getModules,
    staleTime: 10_000,
  })
}

export function useEnableModule() {
  const queryClient = useQueryClient()

  return useMutation<ModuleActionResponse, Error, string>({
    mutationFn: enableModule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules'] })
      queryClient.invalidateQueries({ queryKey: ['containers'] })
    },
  })
}

export function useDisableModule() {
  const queryClient = useQueryClient()

  return useMutation<ModuleActionResponse, Error, string>({
    mutationFn: disableModule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules'] })
      queryClient.invalidateQueries({ queryKey: ['containers'] })
    },
  })
}
