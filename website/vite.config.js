import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/GraphQL/' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/graphql': 'http://localhost:4000',
    },
  },
})
