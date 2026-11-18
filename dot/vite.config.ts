import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import sitemap from 'vite-plugin-sitemap'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    sitemap({
      // The hostname MUST include your repository path for GitHub Pages
      hostname: 'https://Yeshey.github.io/learnWithT',
      // Provide the list of all your pages here
      dynamicRoutes: [
        '/',
        // TODO: replace these with this project's real routes
        '/about',
        '/faq',
      ],
    }),
  ],
  base: '/learnWithT/',
  build: {
    outDir: 'dist',
  },
})