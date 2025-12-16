import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  build: {
    minify: mode === 'development' ? false : 'esbuild',
    sourcemap: mode === 'development',
    rollupOptions: {
      input: {
        offscreen: 'src/offscreen/offscreen.html',
        editor: 'src/editor/index.html',
        permissions: 'src/permissions/permissions.html',
      },
    },
  },
}))
