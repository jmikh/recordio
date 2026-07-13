import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { logEvent } from '../src/logging.js';
import { createFakeDeps } from './fakes/index.js';

/** Captures pino output lines so tests can assert emitted events. */
function captureStream() {
    const lines: Record<string, unknown>[] = [];
    return {
        lines,
        stream: {
            write(chunk: string) {
                for (const line of chunk.split('\n')) {
                    if (line.trim()) lines.push(JSON.parse(line));
                }
            },
        },
    };
}

function appWithLogs() {
    const { lines, stream } = captureStream();
    const app = buildApp(createFakeDeps(), {
        version: 'test-sha',
        env: 'test',
        logStream: stream,
    });
    return { app, lines };
}

describe('canonical request event', () => {
    it('emits exactly one request event with the fixed envelope', async () => {
        const { app, lines } = appWithLogs();
        await app.inject({ method: 'GET', url: '/health' });

        const events = lines.filter((l) => l.msg === 'request');
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            level: 30,
            service: 'recordio-server',
            env: 'test',
            version: 'test-sha',
            'http.route': '/health',
            'http.request.method': 'GET',
            'http.response.status_code': 200,
        });
        expect(events[0].request_id).toBeTruthy();
        expect(typeof events[0].duration_ms).toBe('number');
    });

    it('folds handler-contributed logCtx fields into the event', async () => {
        const { app, lines } = appWithLogs();
        app.get('/test-ctx', async (req) => {
            req.logCtx.set({ 'project.id': 'proj-1' });
            return { ok: true };
        });
        await app.inject({ method: 'GET', url: '/test-ctx' });

        const event = lines.find((l) => l.msg === 'request');
        expect(event).toMatchObject({ 'project.id': 'proj-1' });
    });

    it('redacts secret-shaped fields as a backstop', async () => {
        const { app, lines } = appWithLogs();
        app.get('/test-redact', async (req) => {
            req.log.info({ authorization: 'Bearer secret', nested: { token: 'x' } }, 'oops');
            return { ok: true };
        });
        await app.inject({ method: 'GET', url: '/test-redact' });

        const event = lines.find((l) => l.msg === 'oops');
        expect(event?.authorization).toBe('[redacted]');
        expect((event?.nested as Record<string, unknown>).token).toBe('[redacted]');
    });
});

describe('logEvent catalog', () => {
    it('emits typed business events at info', async () => {
        const { app, lines } = appWithLogs();
        await app.ready();
        logEvent(app.log, 'render_job.completed', { 'render.job_id': 'job-1' });

        const event = lines.find((l) => l.event === 'render_job.completed');
        expect(event).toMatchObject({
            level: 30,
            'render.job_id': 'job-1',
            msg: 'render_job.completed',
        });
    });
});
