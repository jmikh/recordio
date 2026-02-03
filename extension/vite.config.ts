import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path';
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

// Debug overlay flag: set DEBUG_OVERLAY=true to enable debug visualizations
const debugOverlay = process.env.DEBUG_OVERLAY === 'true';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
    plugins: [
        react(),
        crx({ manifest }),
    ],
    resolve: {
        alias: {
            '@shared': resolve(__dirname, '../shared'),
        },
    },
    define: {
        __DEBUG_OVERLAY__: debugOverlay,
    },
    build: {
        outDir: resolve(__dirname, '../dist'),
        minify: mode === 'development' ? false : 'esbuild',
        sourcemap: mode === 'development',
        rollupOptions: {
            input: {
                offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
                controller: resolve(__dirname, 'src/controller/controller.html')
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
