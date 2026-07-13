import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/server.ts'],
    format: 'esm',
    target: 'node22',
    outDir: 'dist',
    clean: true,
    splitting: false,
    sourcemap: true,
    // Don't bundle deps — this runs on Railway with node_modules installed
    external: [/^[^./]/],
});
