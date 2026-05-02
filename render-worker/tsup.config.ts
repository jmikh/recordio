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
    // Externalize native modules and deps that shouldn't be bundled
    external: [
        'playwright',
        'fastify',
        '@supabase/supabase-js',
        'zod',
        'pino',
        'pino-pretty',
    ],
    esbuildOptions(options) {
        // Resolve @shared/* alias
        options.alias = {
            '@shared': resolve(__dirname, '../shared'),
        };
    },
});
