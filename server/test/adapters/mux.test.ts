/**
 * Mux adapter — self-contained (an ephemeral local HTTP server plays the
 * Mux API via the baseUrl override), so it runs in the merge-blocking
 * tier. A real-Mux integration test is deliberately skipped: creating
 * real assets costs storage and the adapter is two trivial calls.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMuxAdapter } from '../../src/adapters/mux.js';
import { MuxApiError } from '../../src/ports/mux.js';

describe('mux adapter', () => {
    let server: Server;

    afterEach(() => {
        server?.close();
    });

    function startMux(statusCode: number, responseBody = '{}') {
        const requests: { method: string; url: string; auth: string; contentType: string; body: string }[] = [];
        server = createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                requests.push({
                    method: req.method!,
                    url: req.url!,
                    auth: req.headers.authorization ?? '',
                    contentType: req.headers['content-type'] ?? '',
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
        return createMuxAdapter({ tokenId: 'token-id', tokenSecret: 'token-secret', baseUrl });
    }

    const EXPECTED_AUTH = `Basic ${Buffer.from('token-id:token-secret').toString('base64')}`;

    it('createAsset POSTs the signed URL with basic auth and returns data.id', async () => {
        const mux = await startMux(201, JSON.stringify({ data: { id: 'asset-123' } }));

        const result = await adapter(mux.url).createAsset('https://s3/get/u/p/renders/v1.mp4');

        expect(result).toEqual({ assetId: 'asset-123' });
        expect(mux.requests).toHaveLength(1);
        expect(mux.requests[0]).toMatchObject({
            method: 'POST',
            url: '/video/v1/assets',
            auth: EXPECTED_AUTH,
            contentType: 'application/json',
        });
        expect(JSON.parse(mux.requests[0].body)).toEqual({
            input: [{ url: 'https://s3/get/u/p/renders/v1.mp4' }],
            playback_policy: ['public'],
        });
    });

    it('createAsset throws MuxApiError with status + snippet on non-2xx', async () => {
        const mux = await startMux(401, '{"error":"bad credentials"}');

        const err = await adapter(mux.url)
            .createAsset('https://s3/get/x')
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(MuxApiError);
        expect((err as MuxApiError).status).toBe(401);
        expect((err as MuxApiError).message).toContain('bad credentials');
    });

    it('deleteAsset DELETEs the asset; 404 counts as success', async () => {
        const mux = await startMux(404, '{"error":"not found"}');

        await adapter(mux.url).deleteAsset('asset-123');

        expect(mux.requests[0]).toMatchObject({
            method: 'DELETE',
            url: '/video/v1/assets/asset-123',
            auth: EXPECTED_AUTH,
        });
    });

    it('deleteAsset throws MuxApiError on other non-2xx', async () => {
        const mux = await startMux(500);

        await expect(adapter(mux.url).deleteAsset('asset-123')).rejects.toThrow(MuxApiError);
    });

    it('verifyWebhookSignature fails loudly until Wave D configures the secret', () => {
        const mux = createMuxAdapter({ tokenId: 't', tokenSecret: 's' });
        expect(() => mux.verifyWebhookSignature('{}', 'sig')).toThrow('not configured');
    });
});
