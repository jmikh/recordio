import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { existsSync, createReadStream } from 'fs';
import type { Plugin } from 'vite';

/**
 * Dev-only: serve the repo's CDN mirror folder for the Personal Settings
 * preview's sample media (plans/user-default-project-settings). In
 * production the same files are fetched from the CDN
 * (webapp/src/core/sampleMedia.ts) — this just lets the placeholders work
 * before they are uploaded.
 */
function serveCdnSamples(): Plugin {
    const samplesDir = resolve(__dirname, '../cdn/samples');
    const contentTypes: Record<string, string> = { avif: 'image/avif', webp: 'image/webp', png: 'image/png' };
    return {
        name: 'recordio-serve-cdn-samples',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use('/samples', (req, res, next) => {
                const name = (req.url ?? '').split('?')[0].replace(/^\//, '');
                // one flat folder — no nested paths, no traversal
                if (!/^[\w.-]+$/.test(name)) return next();
                const file = resolve(samplesDir, name);
                if (!existsSync(file)) return next();
                const ext = name.split('.').pop() ?? '';
                res.setHeader('Content-Type', contentTypes[ext] ?? 'application/octet-stream');
                res.setHeader('Cache-Control', 'no-cache');
                createReadStream(file).pipe(res);
            });
        },
    };
}

export default defineConfig(({ mode }) => ({
    plugins: [react(), serveCdnSamples()],

    define: {
        __DEV_MODE__: mode === 'development',
    },

    root: __dirname,

    // Configure ONNX Runtime WASM handling
    optimizeDeps: {
        exclude: ['onnxruntime-web', '@huggingface/transformers'],
    },

    worker: {
        format: 'es',
    },

    // Ensure WASM files are handled correctly
    assetsInclude: ['**/*.wasm'],

    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@shared': resolve(__dirname, '../shared'),
        },
    },

    server: {
        port: 3001,
        strictPort: true,
    },

    build: {
        outDir: resolve(__dirname, 'dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
            },
        },
    },

    // Ensure assets are copied
    publicDir: resolve(__dirname, 'public'),
}));
