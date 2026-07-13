import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createFakeDeps } from './fakes/index.js';

function testApp() {
    return buildApp(createFakeDeps(), { version: 'test-sha', logLevel: 'silent' });
}

describe('GET /health', () => {
    it('returns ok with the deploy version', async () => {
        const app = testApp();
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'ok', version: 'test-sha' });
    });

    it('unknown routes return 404', async () => {
        const app = testApp();
        const res = await app.inject({ method: 'GET', url: '/nope' });
        expect(res.statusCode).toBe(404);
    });

    it('/debug-sentry throws a 500 (Sentry verification route)', async () => {
        const app = testApp();
        const res = await app.inject({ method: 'GET', url: '/debug-sentry' });
        expect(res.statusCode).toBe(500);
    });
});
