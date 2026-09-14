import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    return ({
        plugins: [react()],
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
    });
});
