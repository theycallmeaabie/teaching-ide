import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Pyodide's ESM entry does feature detection that Vite's dep pre-bundler
  // mangles; the worker loads it from /pyodide/ at runtime instead.
  optimizeDeps: { exclude: ['pyodide'] },
  worker: { format: 'es' },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
