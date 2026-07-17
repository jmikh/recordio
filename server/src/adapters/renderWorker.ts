/**
 * Real render-worker adapter — landed with render-job-create.
 *
 * One POST /render with bearer auth. Thin translation only. Divergence
 * from the edge fn (observability, not contract): a non-2xx worker
 * response throws here — the edge fn ignored it entirely; the route
 * treats submitJob as fire-and-forget and logs the rejection either
 * way, so the HTTP response to the client is unaffected.
 */
import type { RenderJobSubmission, RenderWorkerPort } from '../ports/renderWorker.js';

export interface RenderWorkerAdapterConfig {
    /** Base URL of the render worker (no trailing slash) */
    url: string;
    /** Shared bearer secret (RENDER_SECRET) */
    secret: string;
}

export function createRenderWorkerAdapter(config: RenderWorkerAdapterConfig): RenderWorkerPort {
    return {
        async submitJob(job: RenderJobSubmission) {
            const res = await fetch(`${config.url}/render`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.secret}`,
                },
                body: JSON.stringify(job),
            });
            if (!res.ok) {
                throw new Error(`render worker /render responded ${res.status}`);
            }
        },
    };
}
