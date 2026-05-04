/**
 * Lightweight mock render worker for integration tests.
 *
 * Mimics the real render worker's /render and /health endpoints
 * without Playwright, ffmpeg, or any heavy deps. Starts on port 8090
 * so it doesn't conflict with the real worker (8080).
 *
 * Usage:
 *   import { startMockWorker, stopMockWorker, getRenderRequests } from './mockRenderWorker';
 *   beforeAll(() => startMockWorker());
 *   afterAll(() => stopMockWorker());
 */

import * as http from 'node:http';

const PORT = 8090;
const RENDER_SECRET = 'TYK3YAYQ5pY7JhGXehGT+DJkyW52Zykf4i8HFN1rnYA=';

export interface CapturedRequest {
    body: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined>;
}

const requests: CapturedRequest[] = [];
let server: http.Server | null = null;

export function getRenderRequests(): CapturedRequest[] {
    return requests;
}

export function clearRenderRequests(): void {
    requests.length = 0;
}

export function startMockWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
            // Health check
            if (req.method === 'GET' && req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
                return;
            }

            // Render endpoint
            if (req.method === 'POST' && req.url === '/render') {
                const auth = req.headers.authorization;
                if (auth !== `Bearer ${RENDER_SECRET}`) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }

                const chunks: Buffer[] = [];
                req.on('data', (chunk: Buffer) => chunks.push(chunk));
                req.on('end', () => {
                    const body = JSON.parse(Buffer.concat(chunks).toString());
                    requests.push({ body, headers: req.headers });

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, jobId: body.jobId }));
                });
                return;
            }

            res.writeHead(404);
            res.end('Not found');
        });

        server.listen(PORT, '127.0.0.1', () => {
            console.log(`[MockWorker] Listening on port ${PORT}`);
            resolve();
        });
        server.on('error', reject);
    });
}

export function stopMockWorker(): Promise<void> {
    return new Promise((resolve) => {
        if (!server) { resolve(); return; }
        server.close(() => {
            server = null;
            requests.length = 0;
            resolve();
        });
    });
}
