/**
 * Purge one mux_videos row and its external resources — shared by the
 * `mux_videos.purge-superseded` and `projects.purge-deleted` jobs
 * (Wave C).
 *
 * Order is load-bearing: Mux asset → render file → row. The row is
 * deleted ONLY after both externals are confirmed gone, because the row
 * holds the only reference to them — deleting it first would leak the
 * Mux asset forever (the bug the edge fn had via the project-delete FK
 * cascade). Throws on any failure; the caller's per-item catch decides
 * what to skip (the row is left for the next run).
 */
import type { Deps } from '../deps.js';

export interface MuxVideoPurgeTarget {
    id: string;
    mux_asset_id: string | null;
    render_storage_path: string | null;
}

export async function purgeMuxVideo(
    deps: Pick<Deps, 'db' | 'mux' | 's3'>,
    row: MuxVideoPurgeTarget,
): Promise<void> {
    if (row.mux_asset_id) {
        // 404 (already gone) counts as success — port contract
        await deps.mux.deleteAsset(row.mux_asset_id);
    }
    if (row.render_storage_path) {
        await deps.s3.deleteObjects([row.render_storage_path]);
    }
    await deps.db.query('DELETE FROM mux_videos WHERE id = $1', [row.id]);
}
