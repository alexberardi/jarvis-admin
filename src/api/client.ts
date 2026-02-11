import axios from 'axios'

export const apiClient = axios.create({
  baseURL: '',
})

export function setAuthToken(token: string | null): void {
  if (token) {
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`
  } else {
    delete apiClient.defaults.headers.common['Authorization']
  }
}

let refreshFn: (() => Promise<string | null>) | null = null

export function setRefreshFunction(fn: () => Promise<string | null>): void {
  refreshFn = fn
}

let logoutFn: (() => void) | null = null

export function setLogoutFunction(fn: () => void): void {
  logoutFn = fn
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config

    // Don't intercept auth endpoints — let login/refresh errors pass through
    if (original.url?.startsWith('/api/auth/')) {
      return Promise.reject(error)
    }

    if (error.response?.status === 401 && !original._retry && refreshFn) {
      original._retry = true
      const newToken = await refreshFn()
      if (newToken) {
        original.headers['Authorization'] = `Bearer ${newToken}`
        return apiClient(original)
      }
      logoutFn?.()
    }
    return Promise.reject(error)
  },
)
