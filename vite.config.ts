import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.PORT || '7711'
  const backendUrl = `http://localhost:${backendPort}`

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    // Component tests, matching jarvis-installer's setup. This repo had no
    // frontend test runner at all, which is why two wrong platform labels
    // shipped: the Hardware screen was never executed by anything.
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    },
    server: {
      port: 7710,
      proxy: {
        '/api': backendUrl,
        '/health': backendUrl,
      },
    },
  }
})
