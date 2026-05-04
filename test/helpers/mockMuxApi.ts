/**
 * Mock Mux API server for integration tests.
 *
 * Mimics the Mux Video API endpoints used by edge functions:
 *   POST   /video/v1/assets       → Create asset (returns fake asset ID)
 *   DELETE /video/v1/assets/:id   → Delete asset (returns 204)
 *
 * Also provides a helper to generate valid Mux webhook signatures
 * and fire them at the local mux-video-hook edge function.
 *
 * Usage:
 *   import { startMockMux, stopMockMux, getMuxRequests, fireWebhook } from './mockMuxApi';
 *   beforeAll(() => startMockMux());
 *   afterAll(() => stopMockMux());
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';

const PORT = 8091;

/** Matches the MUX_WEBHOOK_SECRET set in supabase/.env.local */
export const MUX_WEBHOOK_SECRET = 'test-mux-webhook-secret';

export interface CapturedMuxRequest {
    method: string;
    path: string;
    body: Record<string, unknown> | null;
    headers: Record<string, string | string[] | undefined>;
}

const requests: CapturedMuxRequest[] = [];
let server: http.Server | null = null;
let assetCounter = 0;

/** All requests received by the mock. */
export function getMuxRequests(): CapturedMuxRequest[] {
    return requests;
}

export function clearMuxRequests(): void {
    requests.length = 0;
}

export function startMockMux(): Promise<void> {
    assetCounter = 0;
    return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
            const url = new URL(req.url ?? '/', 'http://localhost');

            // POST /video/v1/assets — Create asset
            if (req.method === 'POST' && url.pathname === '/video/v1/assets') {
                const chunks: Buffer[] = [];
                req.on('data', (chunk: Buffer) => chunks.push(chunk));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString());
                    requests.push({ method: 'POST', path: url.pathname, body, headers: req.headers });

                    assetCounter++;
                    const assetId = `mock-asset-${assetCounter}`;

                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        data: {
                            id: assetId,
                            status: 'preparing',
                            playback_ids: [{ id: `mock-playback-${assetCounter}`, policy: 'public' }],
                        },
                    }));
                });
                return;
            }

            // DELETE /video/v1/assets/:id — Delete asset
            if (req.method === 'DELETE' && url.pathname.startsWith('/video/v1/assets/')) {
                requests.push({ method: 'DELETE', path: url.pathname, body: null, headers: req.headers });
                res.writeHead(204);
                res.end();
                return;
            }

            res.writeHead(404);
            res.end('Not found');
        });

        server.listen(PORT, '127.0.0.1', () => {
            console.log(`[MockMux] Listening on port ${PORT}`);
            resolve();
        });
        server.on('error', reject);
    });
}

export function stopMockMux(): Promise<void> {
    return new Promise((resolve) => {
        if (!server) { resolve(); return; }
        server.close(() => {
            server = null;
            requests.length = 0;
            resolve();
        });
    });
}

/**
 * Generate a valid Mux webhook signature for a given body.
 * Uses HMAC-SHA256 with the test webhook secret.
 */
export function signWebhookPayload(body: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = crypto
        .createHmac('sha256', MUX_WEBHOOK_SECRET)
        .update(`${timestamp}.${body}`)
        .digest('hex');
    return `t=${timestamp},v1=${signature}`;
}

/**
 * Fire a webhook event at the local mux-video-hook edge function.
 *
 * @param eventType - e.g. 'video.asset.ready' or 'video.asset.errored'
 * @param data - the event data payload
 * @param anonKey - Supabase anon key (needed for edge function routing)
 */
export async function fireWebhook(
    eventType: string,
    data: Record<string, unknown>,
    anonKey: string,
): Promise<Response> {
    const body = JSON.stringify({ type: eventType, data });
    const signature = signWebhookPayload(body);

    return fetch('http://127.0.0.1:54321/functions/v1/mux-video-hook', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': anonKey,
            'mux-signature': signature,
        },
        body,
    });
}
