import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  base: '/',
  // The frontend env file lives in web/.env (one level above web/dot).
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0', // listen on all interfaces, including the Tailscale one
    allowedHosts: ['.ts.net'],
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/img': 'http://127.0.0.1:8000',
    },
  },
})
