import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-charts': ['recharts'],
          'vendor-storage': ['dexie', 'dexie-react-hooks'],
          'vendor-forms': ['zod', 'react-hook-form', '@hookform/resolvers/zod'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-alert-dialog'],
        },
      },
    },
  },
  test: { environment: 'node', setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.ts'] },
})
