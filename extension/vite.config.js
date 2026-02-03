var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
// Debug overlay flag: set DEBUG_OVERLAY=true to enable debug visualizations
var debugOverlay = process.env.DEBUG_OVERLAY === 'true';
// https://vite.dev/config/
export default defineConfig(function (_a) {
    var mode = _a.mode;
    return ({
        plugins: [
            react(),
            crx({ manifest: manifest }),
        ],
        resolve: {
            alias: {
                '@shared': resolve(__dirname, '../shared'),
            },
        },
        define: {
            __DEBUG_OVERLAY__: debugOverlay,
        },
        // Chrome extensions require relative paths for assets
        base: './',
        build: __assign({ outDir: resolve(__dirname, 'dist'), minify: mode === 'development' ? false : 'esbuild', sourcemap: mode === 'development', rollupOptions: {
                input: {
                    offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
                    controller: resolve(__dirname, 'src/controller/controller.html')
                },
                output: {},
            } }, (mode === 'production' && {
            esbuild: {
                drop: ['console'],
                pure: ['console.log']
            }
        })),
    });
});
