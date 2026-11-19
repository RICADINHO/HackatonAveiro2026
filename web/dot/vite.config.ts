import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import sitemap from 'vite-plugin-sitemap'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    sitemap({
      // hostname MUST match the deployed Pages URL — no trailing slash
      hostname: 'https://ricadinho.github.io/HackatonAveiro2026',
      // Only list routes that actually exist in the app.
      // This project has no router (just App.tsx), so only "/" is real.
      dynamicRoutes: ['/'],
    }),
  ],
  // MUST be the repo name with slashes on both sides, case-sensitive.
  base: '/HackatonAveiro2026/',
  build: {
    outDir: 'dist',
  },
})