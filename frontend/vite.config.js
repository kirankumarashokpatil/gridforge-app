import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {},
  test: {
    exclude: ['test/e2e/**', 'node_modules/**'],
  },
})
