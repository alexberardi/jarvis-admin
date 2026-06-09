import { apiClient } from './client'

export interface AdminHousehold {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export interface AdminNode {
  node_id: string
  name: string
  household_id: string
  is_active: boolean
  registered_by_user_id: number | null
  created_at: string
  updated_at: string | null
  last_rotated_at: string | null
  services: string[]
}

export async function fetchAllHouseholds(): Promise<AdminHousehold[]> {
  const { data } = await apiClient.get<AdminHousehold[]>('/api/admin/households')
  return data
}

export async function fetchAllNodes(): Promise<AdminNode[]> {
  const { data } = await apiClient.get<AdminNode[]>('/api/admin/nodes')
  return data
}
