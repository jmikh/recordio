/**
 * Render-job get-or-create core — everything the /render-job-create route
 * does AFTER its editor check, extracted so mux-video-create can call it
 * in-process (the edge fn made this hop over HTTP with the service-role
 * key; the server never implements that auth path — it dies with the edge
 * fn at decommission).
 *
 * Resolves a render job for (projectId, cloudVersion) via the
 * `render_job_get_or_create` RPC — atomic cache-hit / dedup / retry /
 * insert; it stays SQL on purpose (it takes explicit $user_id, no
 * auth.uid(), so it works over the pool, and reimplementing it in TS
 * would lose the atomicity). On a new/retried job: presign GETs for the
 * project's media + a PUT for the output path, then dispatch to the
 * render worker FIRE-AND-FORGET (not awaited; failures are logged only —
 * the stale-job cron is the safety net, edge-fn parity).
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

    const { rows: jobRows } = await deps.db.query(
        'SELECT job_id, status, is_new, render_storage_path FROM render_job_get_or_create($1, $2, $3)',
        [projectId, userId, cloudVersion],
    );
    const job = jobRows[0] as JobResolution | undefined;
    if (!job) throw new Error('render_job_get_or_create returned no row');

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
