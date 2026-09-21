/**
 * Publish-to-Mux core — everything /mux-video-create does AFTER its
 * editor + entitlement checks, extracted so shared-video-get can
 * self-heal a shared link whose video is missing (no mux_videos row at
 * all) or failed, without duplicating the upsert/dispatch/upload chain.
 *
 * Resolves a mux_video row for (projectId, cloudVersion) via an upsert on
 * the (project_id, cloud_version) unique index — atomic cache-hit / dedup
 * / retry / insert in one statement. On a new/retried row: get-or-create
 * the render job in-process at MUX_RENDER_QUALITY, and if that render is
 * already completed, upload it to Mux right here. Otherwise the render
 * worker's webhook uploads on completion.
 *
 * ATTRIBUTION: `ownerId` is the project OWNER, never the caller — mux_videos,
 * render_jobs and the render storage path all live under the owner's prefix.
 *
 * Failure contract: any failure in the render step marks the mux_video
 * `failed` with `Render dispatch failed` before rethrowing — the row must
 * not sit pending forever. A Mux upload failure is marked inside
 * uploadToMux with its own error string.
 *
 * ATTEMPT BUDGET (canAttemptPublish): shared-video-get lets ANY viewer —
 * including an anonymous one — trigger this, so the retry path is capped.
 * Two counters, because neither alone bounds every failure:
 *   - render_jobs.attempt_count — the expensive counter. Bumped by
 *     getOrCreateRenderJob's retried branch on every re-dispatch.
 *   - mux_videos.attempt — bumped by the upsert below. Covers the one
 *     path the render counter cannot see: Mux's asset.errored webhook
 *     fails the mux row while the render job stays 'completed', so a
 *     retry hits the render cache (attempt_count frozen) and re-uploads
 *     to Mux, minting a new asset on every poll.
 * Neither counter moves on failure — both move on the NEXT dispatch, so
 * in the ordinary render-failure path they stay in lockstep.
 */
import type { Deps } from '../deps.js';
import { getOrCreateRenderJob, type RenderJobResolution } from './renderJobs.js';
import { markMuxVideoFailed, uploadToMux, MUX_RENDER_QUALITY } from './muxUpload.js';

/** Dispatches allowed before the cooldown; the 6th waits it out. */
export const MAX_PUBLISH_ATTEMPTS = 5;
/** Once the budget is spent, one more dispatch is allowed per hour. */
export const PUBLISH_COOLDOWN_SECONDS = 60 * 60;

/** Structural sink for the fire-and-forget dispatch warning (req.log satisfies it). */
interface WarnSink {
    warn(obj: object, msg?: string): void;
}

interface MuxVideoResolution {
    mux_video_id: string;
    status: string;
    is_new: boolean;
}

export interface PublishResult {
    muxVideoId: string;
    status: string;
    isNew: boolean;
    /** Absent when an existing completed/pending row short-circuited the dispatch */
    renderJobId?: string;
    /** Only set when a cache-hit render was uploaded to Mux inside this call */
    muxAssetId?: string;
}

export interface PublishAttemptState {
    /** mux_videos.attempt for the target (project, cloudVersion); null when no row */
    muxAttempt: number | null;
    /** mux_videos.updated_at is inside the cooldown window */
    muxRecent: boolean | null;
    /** render_jobs.attempt_count for the target (project, cloudVersion, MUX_RENDER_QUALITY); null when no row */
    renderAttemptCount: number | null;
    /** render_jobs.updated_at is inside the cooldown window */
    renderRecent: boolean | null;
}

/**
 * Whether an automatic publish may be dispatched. Blocked when EITHER
 * counter has spent its budget and that row was touched within the
 * cooldown.
 *
 * The "within the cooldown" comparison is made in SQL by the caller, not
 * here: both `updated_at` columns are written with the database's NOW(),
 * so measuring them against the app's clock would be comparing two
 * clocks. Pure, so it can be unit-tested without a database — and it must
 * be consulted BEFORE publishProjectToMux, whose upsert would otherwise
 * flip the row back to 'pending' and strand the page there.
 */
export function canAttemptPublish(state: PublishAttemptState): boolean {
    const spent = (attempts: number | null, recent: boolean | null): boolean =>
        attempts !== null && attempts >= MAX_PUBLISH_ATTEMPTS && recent === true;

    return !spent(state.muxAttempt, state.muxRecent)
        && !spent(state.renderAttemptCount, state.renderRecent);
}

export interface PublishProjectToMuxOptions {
    projectId: string;
    /** The project OWNER's id — never the caller's (see ATTRIBUTION above) */
    ownerId: string;
    cloudVersion: number;
    statusCallbackUrl: string;
    log: WarnSink;
}

export async function publishProjectToMux(
    deps: Pick<Deps, 'db' | 'clock' | 's3' | 'mux' | 'renderWorker'>,
    opts: PublishProjectToMuxOptions,
): Promise<PublishResult> {
    const { projectId, ownerId, cloudVersion, statusCallbackUrl, log } = opts;

    // Inline port of mux_video_get_or_create (SQL fn graveyarded
    // 2026-07-25) as a true upsert on the (project_id, cloud_version)
    // unique index: insert → is_new; conflict with a failed/canceled row
    // → RESET to pending (spending one attempt), is_new; conflict with
    // completed/pending → the DO UPDATE's WHERE skips it and the fallback
    // SELECT returns the untouched row, is_new false.
    const { rows } = await deps.db.query(
        `WITH upserted AS (
            INSERT INTO mux_videos (project_id, user_id, cloud_version, status)
            VALUES ($1, $2, $3, 'pending')
            ON CONFLICT (project_id, cloud_version) DO UPDATE
                SET status = 'pending',
                    error = NULL,
                    mux_asset_id = NULL,
                    mux_playback_id = NULL,
                    render_storage_path = NULL,
                    attempt = mux_videos.attempt + 1,
                    updated_at = NOW()
                WHERE mux_videos.status NOT IN ('completed', 'pending')
            RETURNING id, status, TRUE AS is_new
        )
        SELECT u.id AS mux_video_id, u.status, u.is_new FROM upserted u
        UNION ALL
        SELECT mv.id, mv.status, FALSE
        FROM mux_videos mv
        WHERE mv.project_id = $1 AND mv.cloud_version = $3
          AND NOT EXISTS (SELECT 1 FROM upserted)`,
        [projectId, ownerId, cloudVersion],
    );
    const result = rows[0] as MuxVideoResolution | undefined;
    if (!result) throw new Error('mux video get-or-create returned no row');

    const muxVideoId = result.mux_video_id;

    // Existing row — completed or in-flight; return as-is
    if (!result.is_new) {
        return { muxVideoId, status: result.status, isNew: false };
    }

    // New/retried row: get-or-create the render job (in-process). On
    // failure: mark the mux_video failed before rethrowing so the row
    // doesn't sit in 'pending' forever.
    let render: RenderJobResolution;
    try {
        const resolution = await getOrCreateRenderJob(deps, {
            projectId,
            userId: ownerId,
            cloudVersion,
            // Mux streams a single quality (1080p) regardless of what the
            // user picks for downloads — cached per (project, version,
            // quality), so this is its own render job.
            quality: MUX_RENDER_QUALITY,
            statusCallbackUrl,
            log,
        });
        // Only reachable via a project delete mid-request
        if (!resolution) throw new Error('Project not found during render job creation');
        render = resolution;
    } catch (err) {
        await markMuxVideoFailed(deps, muxVideoId, 'Render dispatch failed');
        throw err;
    }

    // Render already done (cache hit) — upload to Mux now; otherwise the
    // worker's render-job-webhook callback uploads on completion
    let muxAssetId: string | undefined;
    if (render.status === 'completed' && render.renderStoragePath) {
        const upload = await uploadToMux(deps, {
            muxVideoId,
            renderStoragePath: render.renderStoragePath,
        });
        if (!upload.success) {
            throw new Error(`Mux upload failed: ${upload.error ?? 'unknown'}`);
        }
        muxAssetId = upload.muxAssetId;
    }

    return { muxVideoId, status: 'pending', isNew: true, renderJobId: render.jobId, muxAssetId };
}
