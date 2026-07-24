import { defineConfig } from 'tsup';
import { resolve } from 'path';

export default defineConfig({
    entry: ['src/server.ts'],
    format: 'esm',
    target: 'node22',
    outDir: 'dist',
    clean: true,
    splitting: false,
    sourcemap: true,
    // Don't bundle deps — this runs on Railway with node_modules installed.
    // @shared/* is repo source (shared/), not a package: keep it in the
    // bundle and resolve it via the alias below.
    external: [/^[^./]/],
    noExternal: [/^@shared\//],
    esbuildOptions(options) {
        options.alias = {
            '@shared': resolve(__dirname, '../shared'),
        };
    },
});
