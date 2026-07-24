/**
 * Client↔server contract for the render-job routes
 * (plans/shared-api-contract.md). Same rules as the sibling files:
 * schemas are the server's runtime validation, interfaces cover the
 * schema-less jsonb responses.
 */
import { Type, type Static } from '@sinclair/typebox';

// ── POST /render-job-get-status ──────────────────────────────────

export const RenderJobGetStatusRequestSchema = Type.Object({
    jobId: Type.String({ minLength: 1 }),
});
export type RenderJobGetStatusRequest = Static<typeof RenderJobGetStatusRequestSchema>;

/**
 * Snake_case as the poller consumes it (jsonb passthrough, no response
 * schema server-side). `job: null` = unknown job id — the poller skips
 * the tick instead of erroring.
 */
export interface RenderJobStatus {
    status: string;
    progress: number | null;
    error: string | null;
    render_storage_path: string | null;
}

export interface RenderJobGetStatusResponse {
    job: RenderJobStatus | null;
}
