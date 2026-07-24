import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
        environment: 'node',
    },
    resolve: {
        alias: {
            '@shared': new URL('../shared', import.meta.url).pathname,
        },
    },
});
