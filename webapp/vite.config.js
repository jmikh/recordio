import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
export default defineConfig({
    plugins: [react()],
    root: __dirname,
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
