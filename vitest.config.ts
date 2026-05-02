import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: [
            'shared/**/*.test.ts',
            'webapp/src/**/*.test.ts',
            'render-worker/src/**/*.test.ts',
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
