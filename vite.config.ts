import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path';
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
        editor: resolve(__dirname, 'src/editor/index.html'),
        offscreen: resolve(__dirname, 'src/recording/offscreen.html'),
        permissions: resolve(__dirname, 'src/permissions/permissions.html'),
        calibration: resolve(__dirname, 'src/calibration/index.html'),
        controller: resolve(__dirname, 'src/recording/controller.html')
      },
      output: {},
    },
  },
}))
