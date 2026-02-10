import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import { ThemeProvider } from '@/theme/ThemeProvider'
import { DiscoveryProvider } from '@/discovery'
import { AuthProvider } from '@/auth/AuthContext'
import AppShell from '@/components/layout/AppShell'
import LoginPage from '@/pages/LoginPage'
import SettingsPage from '@/pages/SettingsPage'
import ServicesPage from '@/pages/ServicesPage'
import NotFoundPage from '@/pages/NotFoundPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <ThemeProvider>
      <DiscoveryProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<AppShell />}>
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/services" element={<ServicesPage />} />
                  <Route path="/" element={<Navigate to="/settings" replace />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
            <Toaster position="bottom-right" richColors />
          </AuthProvider>
        </QueryClientProvider>
      </DiscoveryProvider>
    </ThemeProvider>
  )
}
