import { authClient } from './client'

export interface AuthUser {
  id: number
  email: string
  username?: string
  is_superuser: boolean
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  user: AuthUser
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const { data } = await authClient.post<TokenResponse>('/auth/login', { email, password })
  return data
}

export async function refresh(refreshToken: string): Promise<TokenResponse> {
  const { data } = await authClient.post<TokenResponse>('/auth/refresh', {
    refresh_token: refreshToken,
  })
  return data
}

export async function getMe(accessToken: string): Promise<AuthUser> {
  const { data } = await authClient.get<AuthUser>('/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return data
}
