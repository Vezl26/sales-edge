import { defineConfig } from 'vite'

// base './' so the same build works from GitHub Pages and inside a packed .ehpk
export default defineConfig({
  base: './',
  build: { target: 'es2020', outDir: 'dist', emptyOutDir: true },
})
