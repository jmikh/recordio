/**
 * POST /send-welcome-email — pure unit tier: the route touches NO
 * database (throwing-db throughout), only the email port. Pins the
 * unsubscribe REMOVAL (no unsubscribe link in the html — user decision
 * 2026-07-23) and the requireServiceBearer auth.
 */
import { describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { createFakeDeps, type FakeDeps } from './fakes/index.js';
import { TEST_JWT_SECRET } from './helpers/tokens.js';

const TEST_SUPABASE_URL = 'http://127.0.0.1:54321';
const TEST_SERVICE_ROLE_KEY = 'test-service-role-key';

function build(deps: FakeDeps, logStream?: { write(chunk: string): void }) {
    return buildApp(deps, {
        supabaseJwtSecret: TEST_JWT_SECRET,
        supabaseUrl: TEST_SUPABASE_URL,
        serviceRoleKey: TEST_SERVICE_ROLE_KEY,
        ...(logStream ? { logStream } : { logLevel: 'silent' }),
    });
}

async function post(app: App, payload: unknown, bearer?: string) {
    return app.inject({
        method: 'POST',
        url: '/send-welcome-email',
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
        payload: payload as Record<string, unknown>,
    });
}

describe('POST /send-welcome-email', () => {
    it('401 without a bearer — even with a garbage body (auth precedes validation)', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, { nonsense: true });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('401 with the wrong bearer', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, { record: { id: 'u-1' } }, 'wrong-secret');
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('schema 400 without a record (edge fn: 400 No record)', async () => {
        const app = build(createFakeDeps());
        const res = await post(app, { type: 'INSERT' }, TEST_SERVICE_ROLE_KEY);
        expect(res.statusCode).toBe(400);
    });

    it('record without an email: skipped, nothing sent (parity branch)', async () => {
        const deps = createFakeDeps();
        const app = build(deps);
        const res = await post(app, { record: { id: 'u-1' } }, TEST_SERVICE_ROLE_KEY);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ skipped: true, reason: 'no email' });
        expect(deps.email.sent).toHaveLength(0);
    });

    it('sends the welcome email with the exact subject and adapter-default from/replyTo', async () => {
        const deps = createFakeDeps();
        const app = build(deps);

        const res = await post(
            app,
            { record: { id: 'u-1', email: 'new-user@example.com' } },
            TEST_SERVICE_ROLE_KEY,
        );

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ sent: true });
        expect(deps.email.sent).toHaveLength(1);
        const [message] = deps.email.sent;
        expect(message.to).toBe('new-user@example.com');
        expect(message.subject).toBe("Welcome to Recordio — I'd love your feedback");
        expect(message.from).toBeUndefined();
        expect(message.replyTo).toBeUndefined();
        expect(message.html).toContain('Welcome to Recordio 🎉');
        expect(message.html).toContain('https://app.recordio.io/assets/images/john.webp');
    });

    it('REMOVAL PIN: the html carries NO unsubscribe link (feature removed 2026-07-23)', async () => {
        const deps = createFakeDeps();
        const app = build(deps);

        await post(app, { record: { id: 'u-1', email: 'x@example.com' } }, TEST_SERVICE_ROLE_KEY);

        expect(deps.email.sent[0].html).not.toMatch(/unsubscribe/i);
    });

    it('a failed Resend send → 500 (pg_net ignores it; logs are the surface)', async () => {
        const deps = createFakeDeps();
        deps.email.nextResult = { success: false, error: 'rate limited' };
        const app = build(deps);

        const res = await post(
            app,
            { record: { id: 'u-1', email: 'x@example.com' } },
            TEST_SERVICE_ROLE_KEY,
        );
        expect(res.statusCode).toBe(500);
    });

    it('contributes email.template to the canonical event', async () => {
        const lines: Record<string, unknown>[] = [];
        const app = build(createFakeDeps(), {
            write(chunk: string) {
                for (const line of chunk.split('\n')) {
                    if (line.trim()) lines.push(JSON.parse(line));
                }
            },
        });

        const res = await post(
            app,
            { record: { id: 'u-1', email: 'x@example.com' } },
            TEST_SERVICE_ROLE_KEY,
        );
        expect(res.statusCode).toBe(200);

        expect(lines.find((l) => l.msg === 'request')).toMatchObject({
            'http.route': '/send-welcome-email',
            'http.response.status_code': 200,
            'email.template': 'welcome',
        });
    });
});
