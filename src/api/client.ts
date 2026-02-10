import axios from 'axios'

export const authClient = axios.create()

export const settingsClient = axios.create()

/**
 * Configure base URLs for API clients after network discovery resolves.
 * Must be called before any API requests are made.
 */
export function configureClients(authUrl: string, settingsUrl: string) {
  authClient.defaults.baseURL = authUrl
  settingsClient.defaults.baseURL = settingsUrl
}

export function setAuthToken(token: string | null) {
  if (token) {
    settingsClient.defaults.headers.common['Authorization'] = `Bearer ${token}`
  } else {
    delete settingsClient.defaults.headers.common['Authorization']
  }
}

let refreshFn: (() => Promise<string | null>) | null = null

export function setRefreshFunction(fn: () => Promise<string | null>) {
  refreshFn = fn
}

let logoutFn: (() => void) | null = null

export function setLogoutFunction(fn: () => void) {
  logoutFn = fn
}

settingsClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry && refreshFn) {
      original._retry = true
      const newToken = await refreshFn()
      if (newToken) {
        original.headers['Authorization'] = `Bearer ${newToken}`
        return settingsClient(original)
      }
      logoutFn?.()
    }
    return Promise.reject(error)
  },
)
