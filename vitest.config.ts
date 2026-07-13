import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load .env.test before any test code runs (needed by render-worker config.ts etc.)
config({ path: '.env.test' });

export default defineConfig({
    test: {
        include: [
            'shared/**/*.test.ts',
            'webapp/src/**/*.test.ts',
            'render-worker/src/**/*.test.ts',
            'server/src/**/*.test.ts',
            'server/test/**/*.test.ts',
            'test/**/*.test.ts',
        ],
        environment: 'node',
    },
    resolve: {
        alias: {
            '@shared': new URL('./shared', import.meta.url).pathname,
            '@': new URL('./webapp/src', import.meta.url).pathname,
        },
    },
});
