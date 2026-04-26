import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    root: __dirname,

    resolve: {
        alias: {
            '@shared': resolve(__dirname, '../../shared'),
            // Point webapp imports to the actual webapp source
            '../../webapp/src': resolve(__dirname, '../../webapp/src'),
        },
    },

    // web-demuxer WASM needs to be served
    assetsInclude: ['**/*.wasm'],

    build: {
        outDir: resolve(__dirname, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
            },
        },
    },

    // Copy WASM files from webapp/public so FrameExtractor can find them
    publicDir: resolve(__dirname, '../../webapp/public'),

    server: {
        port: 3002,
    },
});
