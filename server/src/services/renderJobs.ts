/**
 * Render-job get-or-create core — everything the /render-job-create route
 * does AFTER its editor check, extracted so mux-video-create can call it
 * in-process (the edge fn made this hop over HTTP with the service-role
 * key; the server never implements that auth path — it dies with the edge
 * fn at decommission).
 *
 * Resolves a render job for (projectId, cloudVersion) via one inline
 * data-modifying CTE — atomic cache-hit / dedup / retry / insert in a
 * single statement (was the `render_job_get_or_create` SQL fn until the
 * 2026-07-25 sweep; the CTE keeps its exact semantics). On a
 * new/retried job: presign GETs for the project's media + a PUT for the
 * output path, then dispatch to the render worker FIRE-AND-FORGET (not
 * awaited; failures are logged only — the stale-job cron is the safety
 * net, edge-fn parity).
 *
 * `userId` is whoever the render is attributed to — the CALLER on the
 * direct route, the project OWNER when mux-video-create triggers it
 * (edge-fn parity; the render path is namespaced by this id).
 *
 * Returns null when the project row is gone — kept as a second query for
 * edge-fn parity (its admin re-read); reachable-miss only via a delete
 * between the caller's editor check and this read.
 */
import type { Deps } from '../deps.js';
import { getProjectMediaPaths } from './projectMedia.js';

interface JobResolution {
    job_id: string;
    status: string;
    is_new: boolean;
    render_storage_path: string | null;
}

export interface RenderJobResolution {
    jobId: string;
    status: string;
    renderStoragePath: string | null;
}

/** Structural sink for the fire-and-forget dispatch warning (req.log satisfies it). */
interface WarnSink {
    warn(obj: object, msg?: string): void;
}

export interface GetOrCreateRenderJobOptions {
    projectId: string;
    userId: string;
    cloudVersion: number;
    statusCallbackUrl: string;
    log: WarnSink;
}

export async function getOrCreateRenderJob(
    deps: Pick<Deps, 'db' | 's3' | 'renderWorker'>,
    opts: GetOrCreateRenderJobOptions,
): Promise<RenderJobResolution | null> {
    const { projectId, userId, cloudVersion, statusCallbackUrl, log } = opts;

    const { rows: projectRows } = await deps.db.query(
        `SELECT name, project_data FROM projects
         WHERE id = $1 AND deleted_at IS NULL`,
        [projectId],
    );
    const project = projectRows[0] as
        | { name: string; project_data: unknown }
        | undefined;
    if (!project) return null;

    // Inline port of render_job_get_or_create (SQL fn graveyarded
    // 2026-07-25): one data-modifying CTE = one atomic statement, same
    // snapshot for all branches. Cache-hit (completed) and dedup
    // (pending) return the existing row; failed/canceled rows are
    // RESET (attempt bump, timings cleared, path recomputed under the
    // CALLER's prefix — known smell, parity); no row → insert. Same
    // race profile as the fn: no unique index covers non-completed
    // rows, so a concurrent first render can double-insert (rare,
    // benign — the stale-job cron reaps the loser).
    const renderStoragePath = `${userId}/${projectId}/renders/v${cloudVersion}.mp4`;
    const { rows: jobRows } = await deps.db.query(
        `WITH existing AS (
            SELECT id, status, render_storage_path
            FROM render_jobs
            WHERE project_id = $1 AND cloud_version = $3
        ), retried AS (
            UPDATE render_jobs rj
            SET status = 'pending',
                progress = NULL,
                attempt_count = rj.attempt_count + 1,
                render_storage_path = $4,
                start_duration_s = NULL,
                download_duration_s = NULL,
                render_duration_s = NULL,
                upload_duration_s = NULL,
                total_duration_s = NULL,
                updated_at = NOW()
            FROM existing e
            WHERE rj.id = e.id AND e.status NOT IN ('completed', 'pending')
            RETURNING rj.id
        ), inserted AS (
            INSERT INTO render_jobs (project_id, user_id, cloud_version, render_storage_path)
            SELECT $1, $2, $3, $4
            WHERE NOT EXISTS (SELECT 1 FROM existing)
            RETURNING id
        )
        SELECT e.id AS job_id, e.status, FALSE AS is_new, e.render_storage_path
        FROM existing e WHERE e.status IN ('completed', 'pending')
        UNION ALL
        SELECT r.id, 'pending', TRUE, $4 FROM retried r
        UNION ALL
        SELECT i.id, 'pending', TRUE, $4 FROM inserted i`,
        [projectId, userId, cloudVersion, renderStoragePath],
    );
    const job = jobRows[0] as JobResolution | undefined;
    if (!job) throw new Error('render job get-or-create returned no row');

    // Cache hit or dedup — no presigning, no dispatch
    if (!job.is_new) {
        return {
            jobId: job.job_id,
            status: job.status,
            renderStoragePath: job.render_storage_path,
        };
    }

    // New (or retried) job: presign media downloads + output upload
    const mediaUrls: Record<string, string> = {};
    await Promise.all(
        getProjectMediaPaths(project.project_data).map(async (entry) => {
            mediaUrls[entry.storagePath] = await deps.s3.presignDownload(
                entry.storagePath,
                3600,
            );
        }),
    );
    const uploadUrl = await deps.s3.presignUpload(job.render_storage_path!, 3600);

    // Fire-and-forget (edge-fn parity): the response never waits on
    // the worker; a failed dispatch is caught by the stale-job cron
    void deps.renderWorker
        .submitJob({
            jobId: job.job_id,
            projectData: project.project_data,
            projectName: project.name,
            quality: '1080p',
            mediaUrls,
            uploadUrl,
            statusCallbackUrl,
        })
        .catch((err: unknown) => {
            log.warn(
                { err, 'render.job_id': job.job_id },
                'render worker dispatch failed',
            );
        });

    return {
        jobId: job.job_id,
        status: 'pending',
        renderStoragePath: job.render_storage_path,
    };
}
