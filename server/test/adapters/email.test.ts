/**
 * Email (Resend) adapter — self-contained (an ephemeral local HTTP
 * server plays the Resend API via the baseUrl override), so it runs in
 * the merge-blocking tier. Mirrors test/adapters/mux.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createEmailAdapter } from '../../src/adapters/email.js';

describe('email adapter (Resend)', () => {
    let server: Server;

    afterEach(() => {
        server?.close();
    });

    function startResend(statusCode: number, responseBody = '{"id":"email_1"}') {
        const requests: { method: string; url: string; auth: string; body: string }[] = [];
        server = createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                requests.push({
                    method: req.method!,
                    url: req.url!,
                    auth: req.headers.authorization ?? '',
                    body,
                });
                res.statusCode = statusCode;
                res.setHeader('Content-Type', 'application/json');
                res.end(responseBody);
            });
        });
        return new Promise<{ url: string; requests: typeof requests }>((resolve) => {
            server.listen(0, '127.0.0.1', () => {
                const { port } = server.address() as AddressInfo;
                resolve({ url: `http://127.0.0.1:${port}`, requests });
            });
        });
    }

    function adapter(baseUrl: string) {
        return createEmailAdapter({ apiKey: 're_test_key', baseUrl });
    }

    it('POSTs the message with bearer auth and the edge-fn defaults for from/reply_to', async () => {
        const resend = await startResend(200);

        const result = await adapter(resend.url).send({
            to: 'user@example.com',
            subject: 'Hello',
            html: '<p>Hi</p>',
        });

        expect(result).toEqual({ success: true });
        expect(resend.requests).toHaveLength(1);
        expect(resend.requests[0]).toMatchObject({
            method: 'POST',
            url: '/emails',
            auth: 'Bearer re_test_key',
        });
        expect(JSON.parse(resend.requests[0].body)).toEqual({
            from: 'Recordio Team <john@recordio.io>',
            to: ['user@example.com'],
            subject: 'Hello',
            html: '<p>Hi</p>',
            reply_to: 'john@recordio.io',
        });
    });

    it('explicit from/replyTo pass through', async () => {
        const resend = await startResend(200);

        await adapter(resend.url).send({
            to: 'user@example.com',
            subject: 'Hello',
            html: '<p>Hi</p>',
            from: 'Other <other@recordio.io>',
            replyTo: 'reply@recordio.io',
        });

        expect(JSON.parse(resend.requests[0].body)).toMatchObject({
            from: 'Other <other@recordio.io>',
            reply_to: 'reply@recordio.io',
        });
    });

    it('non-2xx → success:false with status + body snippet (never throws)', async () => {
        const resend = await startResend(422, '{"message":"invalid to address"}');

        const result = await adapter(resend.url).send({
            to: 'bad',
            subject: 's',
            html: 'h',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Resend API 422');
        expect(result.error).toContain('invalid to address');
    });

    it('transport error → success:false with the message (never throws)', async () => {
        // Nothing listening on this port
        const result = await createEmailAdapter({
            apiKey: 're_test_key',
            baseUrl: 'http://127.0.0.1:1',
        }).send({ to: 'user@example.com', subject: 's', html: 'h' });

        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
    });
});
