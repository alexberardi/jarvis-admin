import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import { ThemeProvider } from '@/theme/ThemeProvider'
import { AuthProvider } from '@/auth/AuthContext'
import AppShell from '@/components/layout/AppShell'
import LoginPage from '@/pages/LoginPage'
import SettingsPage from '@/pages/SettingsPage'
import ServicesPage from '@/pages/ServicesPage'
import DashboardPage from '@/pages/DashboardPage'
import TrainingPage from '@/pages/TrainingPage'
import NodesPage from '@/pages/NodesPage'
import NotFoundPage from '@/pages/NotFoundPage'
import SetupWizard from '@/pages/SetupWizard'

const queryClient = new QueryClient()

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/setup" element={<SetupWizard />} />
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AppShell />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/training" element={<TrainingPage />} />
                <Route path="/nodes" element={<NodesPage />} />
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster position="bottom-right" richColors />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
