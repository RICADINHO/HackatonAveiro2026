import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import sitemap from 'vite-plugin-sitemap'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'pages' && sitemap({
      hostname: 'https://ricadinho.github.io/HackatonAveiro2026',
      dynamicRoutes: ['/'],
    }),
  ],
  base: mode === 'pages' ? '/HackatonAveiro2026/' : '/',
  build: {
    outDir: mode === 'pages' ? 'dist' : '../dist',
    emptyOutDir: true,
  },
  server: {
    host: 'localhost',
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/img': 'http://127.0.0.1:8000',
    },
  },
}))
