import { ProjectStorage } from './projectStorage';

const QUOTA_THRESHOLD = 0.75; // 75% of browser quota
const ABSOLUTE_THRESHOLD = 250 * 1024 * 1024; // 250 MB (testing — restore to 10 GB for prod)
const STALE_MS = 60 * 1000; // 1 minute (testing — restore to 7 days for prod)

/** Prevent concurrent runs. */
let running = false;

function needsCleanup(usage: number, quota: number): boolean {
    return (quota > 0 && usage / quota > QUOTA_THRESHOLD) || usage > ABSOLUTE_THRESHOLD;
}

function fmt(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Cleans up IndexedDB recording blobs to manage storage pressure.
 *
 * Strategy (in order):
 *   1. Delete orphaned recording blobs (no matching project in DB).
 *   2. Always evict cloud-backed projects not accessed for >1 week.
 *   3. If still over threshold (>75% quota or >10 GB), evict remaining
 *      cloud-backed projects oldest-first until below the limit.
 *
 * Safe: only evicts projects whose media is already uploaded to cloud (`uploadStatus === 'ready'`).
 * Runs silently; never throws.
 */
export async function cleanupStorageIfNeeded(): Promise<void> {
    if (running) return;
    running = true;

    try {
        let { usage = 0, quota = 0 } = await navigator.storage.estimate();
        const pct = quota > 0 ? Math.round((usage / quota) * 100) : 0;

        console.log(
            `[StorageCleanup] Storage check — ${fmt(usage)} / ${fmt(quota)} (${pct}%)`,
        );

        if (!needsCleanup(usage, quota)) {
            console.log('[StorageCleanup] Storage is healthy, no cleanup needed');
            return;
        }

        const initialUsage = usage;
        console.warn(
            `[StorageCleanup] Storage pressure detected — ` +
            `${pct}% used (threshold: ${Math.round(QUOTA_THRESHOLD * 100)}%), ` +
            `${fmt(usage)} absolute (threshold: ${fmt(ABSOLUTE_THRESHOLD)})`,
        );

        // ── Phase 1: orphaned recording blobs ────────────────────────
        const blobKeys = await ProjectStorage.listRecordingBlobKeys();
        const projectIds = new Set(await ProjectStorage.listProjectIds());

        console.log(
            `[StorageCleanup] Found ${blobKeys.length} recording blob(s) across ${projectIds.size} project(s)`,
        );

        const orphaned: string[] = [];
        for (const key of blobKeys) {
            // A blob belongs to a project if the project ID appears in its key
            // (matches deleteProject's `key.includes(projectId)` pattern)
            let owned = false;
            for (const pid of projectIds) {
                if (key.includes(pid)) { owned = true; break; }
            }
            if (!owned) orphaned.push(key);
        }

        if (orphaned.length > 0) {
            console.log(`[StorageCleanup] Phase 1: deleting ${orphaned.length} orphaned blob(s):`);
            for (const key of orphaned) {
                console.log(`[StorageCleanup]   - ${key}`);
                await ProjectStorage.deleteRecordingBlob(key);
            }

            ({ usage = 0, quota = 0 } = await navigator.storage.estimate());
            console.log(`[StorageCleanup] After orphan cleanup: ${fmt(usage)} used (freed ${fmt(initialUsage - usage)})`);

            if (!needsCleanup(usage, quota)) {
                console.log('[StorageCleanup] Storage healthy after orphan cleanup, stopping');
                return;
            }
        } else {
            console.log('[StorageCleanup] Phase 1: no orphaned blobs found');
        }

        // ── Build cloud-backed project list sorted oldest-first ──────
        const allSyncMeta = await ProjectStorage.listSyncMeta();
        const now = Date.now();

        const cloudBacked = allSyncMeta
            .filter(m => m.uploadStatus === 'ready' && projectIds.has(m.projectId))
            .sort((a, b) => (a.lastAccessedAt ?? 0) - (b.lastAccessedAt ?? 0)); // oldest first

        const notCloudBacked = projectIds.size - cloudBacked.length;

        const stale = cloudBacked.filter(m => (now - (m.lastAccessedAt ?? 0)) > STALE_MS);
        const fresh = cloudBacked.filter(m => (now - (m.lastAccessedAt ?? 0)) <= STALE_MS);

        console.log(
            `[StorageCleanup] ${cloudBacked.length} cloud-backed project(s) ` +
            `(${stale.length} stale, ${fresh.length} recent), ${notCloudBacked} local-only skipped`,
        );

        // ── Phase 2: always evict stale projects (>1 week) ──────────
        let evictedCount = 0;

        if (stale.length > 0) {
            console.log(`[StorageCleanup] Phase 2: evicting ${stale.length} stale project(s) (>1 week old)`);
            for (const meta of stale) {
                const staleDays = Math.round((now - (meta.lastAccessedAt ?? 0)) / (24 * 60 * 60 * 1000));
                console.log(
                    `[StorageCleanup]   Evicting ${meta.projectId} ` +
                    `(last accessed ${meta.lastAccessedAt ? new Date(meta.lastAccessedAt).toISOString() : 'never'}, ${staleDays}d stale)`,
                );
                await ProjectStorage.deleteProject(meta.projectId);
                evictedCount++;
            }

            ({ usage = 0, quota = 0 } = await navigator.storage.estimate());
            console.log(`[StorageCleanup] After stale eviction: ${fmt(usage)} used (freed ${fmt(initialUsage - usage)})`);
        } else {
            console.log('[StorageCleanup] Phase 2: no stale projects to evict');
        }

        // ── Phase 3: if still over limit, evict recent projects oldest-first ─
        if (needsCleanup(usage, quota) && fresh.length > 0) {
            console.log(`[StorageCleanup] Phase 3: still over threshold, evicting recent projects oldest-first`);

            for (const meta of fresh) {
                const ageDays = Math.round((now - (meta.lastAccessedAt ?? 0)) / (24 * 60 * 60 * 1000));
                console.log(
                    `[StorageCleanup]   Evicting ${meta.projectId} ` +
                    `(last accessed ${meta.lastAccessedAt ? new Date(meta.lastAccessedAt).toISOString() : 'never'}, ${ageDays}d ago)`,
                );

                await ProjectStorage.deleteProject(meta.projectId);
                evictedCount++;

                ({ usage = 0, quota = 0 } = await navigator.storage.estimate());
                console.log(
                    `[StorageCleanup]   Now ${fmt(usage)} (freed ${fmt(initialUsage - usage)} total)`,
                );

                if (!needsCleanup(usage, quota)) {
                    console.log('[StorageCleanup] Storage healthy, stopping eviction');
                    break;
                }
            }
        }

        const finalPct = quota > 0 ? Math.round((usage / quota) * 100) : 0;
        console.log(
            `[StorageCleanup] Complete — freed ${fmt(initialUsage - usage)}, ` +
            `now ${fmt(usage)} / ${fmt(quota)} (${finalPct}%), ` +
            `evicted ${evictedCount} project(s), deleted ${orphaned.length} orphan(s)`,
        );
    } catch (err) {
        console.error('[StorageCleanup] Cleanup failed:', err);
    } finally {
        running = false;
    }
}
