import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPipelineStatus, startBuild, cancelBuild, getArtifacts } from '@/api/training'
import type { PipelineStatus, BuildRequest, ArtifactsResponse } from '@/types/training'

export function usePipelineStatus(polling = false) {
  return useQuery<PipelineStatus>({
    queryKey: ['pipeline-status'],
    queryFn: getPipelineStatus,
    staleTime: 5_000,
    refetchInterval: polling ? 3_000 : false,
  })
}

export function useArtifacts() {
  return useQuery<ArtifactsResponse>({
    queryKey: ['pipeline-artifacts'],
    queryFn: getArtifacts,
    staleTime: 30_000,
  })
}

export function useStartBuild() {
  const queryClient = useQueryClient()

  return useMutation<PipelineStatus, Error, BuildRequest>({
    mutationFn: startBuild,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-status'] })
    },
  })
}

export function useCancelBuild() {
  const queryClient = useQueryClient()

  return useMutation<PipelineStatus, Error, void>({
    mutationFn: cancelBuild,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-status'] })
    },
  })
}
