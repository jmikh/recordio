/**
 * POST /render-job-get-status — render-job polling endpoint
 * (Part 2 Batch 2). Ports render_job_get_status inline: unknown job →
 * `{ job: null }` (the poller just skips a tick — parity with the SQL
 * fn's NULL, and no error noise in logs); editor access on the job's
 * project. The job fields keep the snake_case names the poller consumes
 * (status/progress/error/render_storage_path).
 *
 * A completed job also carries `render_url`, a presigned GET for the MP4
 * (authorized by the editor check). The client asks for it right before
 * downloading, so a retry after the 1h expiry just polls again.
 *
 * Request:  { jobId }
 * Response: { job: {...} | null } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { RenderJobGetStatusRequestSchema, type RenderJobStatus } from '@shared/api/renderJobs';
import { canEditProject } from '../services/projectAccess.js';
import { DOWNLOAD_URL_TTL_SECONDS } from '../services/downloadUrls.js';

export const renderJobGetStatusRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/render-job-get-status',
        {
            preHandler: app.requireUser,
            schema: {
                body: RenderJobGetStatusRequestSchema,
            },
        },
        async (req, reply) => {
            const { jobId } = req.body;
            const db = app.deps.db;
            req.logCtx.set({ 'render.job_id': jobId });

            const { rows: jobRows } = await db.query(
                'SELECT project_id AS "projectId" FROM render_jobs WHERE id = $1',
                [jobId],
            );
            const projectId = (jobRows[0] as { projectId: string } | undefined)?.projectId;
            if (!projectId) {
                return reply.send({ job: null });
            }
            req.logCtx.set({ 'project.id': projectId });

            if (!await canEditProject(db, projectId, req.user!.id)) {
                return reply.code(403).send({ error: 'Not an editor of this project' });
            }

            const { rows } = await db.query(
                `SELECT jsonb_build_object(
                    'status',              rj.status,
                    'progress',            rj.progress,
                    'error',               rj.error,
                    'render_storage_path', rj.render_storage_path
                ) AS job
                FROM render_jobs rj WHERE rj.id = $1`,
                [jobId],
            );
            const job = (rows[0] as { job: Omit<RenderJobStatus, 'render_url'> } | undefined)?.job;
            if (!job) return reply.send({ job: null });

            const renderUrl = job.status === 'completed' && job.render_storage_path
                ? await app.deps.s3.presignDownload(job.render_storage_path, DOWNLOAD_URL_TTL_SECONDS)
                : null;
            return reply.send({ job: { ...job, render_url: renderUrl } });
        },
    );
};
