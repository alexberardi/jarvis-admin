import axios from 'axios'

const AUTH_BASE = import.meta.env.VITE_AUTH_URL ?? 'http://localhost:8007'
const SETTINGS_BASE = import.meta.env.VITE_SETTINGS_URL ?? 'http://localhost:8014'

export const authClient = axios.create({ baseURL: AUTH_BASE })

export const settingsClient = axios.create({ baseURL: SETTINGS_BASE })

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
