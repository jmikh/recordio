/**
 * renderWorker adapter — self-contained (an ephemeral local HTTP server
 * plays the worker), so unlike the S3/Stripe adapter integrations it
 * runs in the merge-blocking tier.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRenderWorkerAdapter } from '../../src/adapters/renderWorker.js';
import type { RenderJobSubmission } from '../../src/ports/renderWorker.js';

const JOB: RenderJobSubmission = {
    jobId: 'job-1',
    projectData: { screenSource: { storagePath: 'u/p/screen.webm' } },
    projectName: 'Test project',
    quality: '1080p',
    mediaUrls: { 'u/p/screen.webm': 'https://s3/get/u/p/screen.webm' },
    uploadUrl: 'https://s3/put/u/p/renders/v1.mp4',
    statusCallbackUrl: 'https://supabase/functions/v1/render-job-hook',
};

describe('renderWorker adapter', () => {
    let server: Server;

    afterEach(() => {
        server?.close();
    });

    function startWorker(statusCode: number) {
        const requests: { url: string; auth: string; contentType: string; body: string }[] = [];
        server = createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                requests.push({
                    url: req.url!,
                    auth: req.headers.authorization ?? '',
                    contentType: req.headers['content-type'] ?? '',
                    body,
                });
                res.statusCode = statusCode;
                res.end();
            });
        });
        return new Promise<{ url: string; requests: typeof requests }>((resolve) => {
            server.listen(0, '127.0.0.1', () => {
                const { port } = server.address() as AddressInfo;
                resolve({ url: `http://127.0.0.1:${port}`, requests });
            });
        });
    }

    it('POSTs the job JSON to /render with bearer auth', async () => {
        const worker = await startWorker(200);
        const adapter = createRenderWorkerAdapter({ url: worker.url, secret: 's3cret' });

        await adapter.submitJob(JOB);

        expect(worker.requests).toHaveLength(1);
        expect(worker.requests[0].url).toBe('/render');
        expect(worker.requests[0].auth).toBe('Bearer s3cret');
        expect(worker.requests[0].contentType).toBe('application/json');
        expect(JSON.parse(worker.requests[0].body)).toEqual(JOB);
    });

    it('throws on a non-2xx worker response (route logs it, fire-and-forget)', async () => {
        const worker = await startWorker(503);
        const adapter = createRenderWorkerAdapter({ url: worker.url, secret: 's3cret' });

        await expect(adapter.submitJob(JOB)).rejects.toThrow('responded 503');
    });
});
