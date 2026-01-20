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
        offscreen: resolve(__dirname, 'src/recording/offscreen/offscreen.html'),

        controller: resolve(__dirname, 'src/recording/controller/controller.html')
      },
      output: {},
    },
    ...(mode === 'production' && {
      esbuild: {
        drop: ['console'],
        pure: ['console.log']
      }
    })
  },
}))
