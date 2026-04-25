import * as Sentry from '@sentry/react';
import { LocalStorage, type SyncMeta } from './localStorage';

const QUOTA_THRESHOLD = 0.75; // 75% of browser quota
const ABSOLUTE_THRESHOLD = 15 * 1024 * 1024 * 1024; // 10 GB
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
 * Delete recording blobs that don't belong to any project.
 */
async function deleteOrphanedBlobs(projectIds: Set<string>): Promise<number> {
    const blobKeys = await LocalStorage.listRecordingBlobKeys();

    const orphaned: string[] = [];
    for (const key of blobKeys) {
        let owned = false;
        for (const pid of projectIds) {
            if (key.includes(pid)) { owned = true; break; }
        }
        if (!owned) orphaned.push(key);
    }

    if (orphaned.length === 0) return 0;

    console.log(`[StorageCleanup] Deleting ${orphaned.length} orphaned blob(s)`);
    for (const key of orphaned) {
        console.log(`[StorageCleanup]   - ${key}`);
        await LocalStorage.deleteRecordingBlob(key);
    }
    return orphaned.length;
}

/**
 * Delete projects that are missing expected blobs and are not cloud-synced.
 */
async function deleteOrphanedProjects(): Promise<number> {
    const orphaned = await LocalStorage.getOrphanedProjects();
    if (orphaned.length === 0) return 0;

    console.warn(`[StorageCleanup] Deleting ${orphaned.length} orphaned project(s)`);
    for (const project of orphaned) {
        console.log(`[StorageCleanup]   - ${project.id} (${project.name})`);
        Sentry.captureException(new Error('Orphaned project: missing blobs and not cloud-synced'), {
            extra: { phase: 'cleanup_orphan', projectId: project.id },
        });
        await LocalStorage.deleteProject(project.id);
    }
    return orphaned.length;
}

/**
 * Evict cloud-backed projects that haven't been accessed in over a week.
 */
async function evictStaleProjects(cloudBacked: SyncMeta[]): Promise<number> {
    const now = Date.now();
    const stale = cloudBacked.filter(m => (now - (m.lastAccessedAt ?? 0)) > STALE_MS);

    if (stale.length === 0) return 0;

    console.log(`[StorageCleanup] Evicting ${stale.length} stale project(s) (>1 week old)`);
    for (const meta of stale) {
        const staleDays = Math.round((now - (meta.lastAccessedAt ?? 0)) / (24 * 60 * 60 * 1000));
        console.log(
            `[StorageCleanup]   Evicting ${meta.projectId} ` +
            `(last accessed ${meta.lastAccessedAt ? new Date(meta.lastAccessedAt).toISOString() : 'never'}, ${staleDays}d stale)`,
        );
        await LocalStorage.deleteProject(meta.projectId);
    }
    return stale.length;
}

/**
 * Evict cloud-backed projects oldest-first until storage is below threshold.
 */
async function evictFreshProjectsUntilHealthy(
    cloudBacked: SyncMeta[],
    initialUsage: number,
): Promise<number> {
    const now = Date.now();
    const fresh = cloudBacked.filter(m => (now - (m.lastAccessedAt ?? 0)) <= STALE_MS);

    if (fresh.length === 0) return 0;

    let { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (!needsCleanup(usage, quota)) return 0;

    console.log(`[StorageCleanup] Still over threshold, evicting recent projects oldest-first`);
    let evicted = 0;

    for (const meta of fresh) {
        const ageDays = Math.round((now - (meta.lastAccessedAt ?? 0)) / (24 * 60 * 60 * 1000));
        console.log(
            `[StorageCleanup]   Evicting ${meta.projectId} ` +
            `(last accessed ${meta.lastAccessedAt ? new Date(meta.lastAccessedAt).toISOString() : 'never'}, ${ageDays}d ago)`,
        );

        await LocalStorage.deleteProject(meta.projectId);
        evicted++;

        ({ usage = 0, quota = 0 } = await navigator.storage.estimate());
        console.log(`[StorageCleanup]   Now ${fmt(usage)} (freed ${fmt(initialUsage - usage)} total)`);

        if (!needsCleanup(usage, quota)) {
            console.log('[StorageCleanup] Storage healthy, stopping eviction');
            break;
        }
    }
    return evicted;
}

/**
 * Cleans up IndexedDB to manage storage pressure.
 *
 * Strategy (in order):
 *   1a. Delete orphaned recording blobs (no matching project in DB).
 *   1b. Delete orphaned projects (missing blobs, not cloud-synced).
 *   2.  Always evict cloud-synced projects not accessed for >1 week.
 *   3.  If still over threshold (>75% quota or >10 GB), evict remaining
 *       cloud-synced projects oldest-first until below the limit.
 *
 * Safe: only evicts projects whose media is already uploaded to cloud (`cloudSynced === true`).
 * Runs silently; never throws.
 */
export async function cleanupStorageIfNeeded(): Promise<void> {
    // TODO: disabled — suspected of deleting blobs for valid projects
    console.log('[StorageCleanup] Skipped (temporarily disabled)');
    return;

    try {
        let { usage = 0, quota = 0 } = await navigator.storage.estimate();
        const pct = quota > 0 ? Math.round((usage / quota) * 100) : 0;

        console.log(`[StorageCleanup] Storage check — ${fmt(usage)} / ${fmt(quota)} (${pct}%)`);

        // Always clean up orphans regardless of storage pressure
        const projectIds = new Set(await LocalStorage.listProjectIds());
        const orphanedBlobs = await deleteOrphanedBlobs(projectIds);
        const orphanedProjects = await deleteOrphanedProjects();

        if (!needsCleanup(usage, quota)) {
            console.log('[StorageCleanup] Storage is healthy, no eviction needed');
            return;
        }

        const initialUsage = usage;
        console.warn(
            `[StorageCleanup] Storage pressure detected — ` +
            `${pct}% used (threshold: ${Math.round(QUOTA_THRESHOLD * 100)}%), ` +
            `${fmt(usage)} absolute (threshold: ${fmt(ABSOLUTE_THRESHOLD)})`,
        );

        ({ usage = 0, quota = 0 } = await navigator.storage.estimate());
        if (!needsCleanup(usage, quota)) {
            console.log(`[StorageCleanup] Storage healthy after orphan cleanup (freed ${fmt(initialUsage - usage)})`);
            return;
        }

        // Build cloud-backed project list sorted oldest-first
        const allSyncMeta = await LocalStorage.listSyncMeta();
        const cloudBacked = allSyncMeta
            .filter(m => m.cloudSynced && projectIds.has(m.projectId))
            .sort((a, b) => (a.lastAccessedAt ?? 0) - (b.lastAccessedAt ?? 0));

        const evictedStale = await evictStaleProjects(cloudBacked);

        ({ usage = 0, quota = 0 } = await navigator.storage.estimate());
        const evictedFresh = needsCleanup(usage, quota)
            ? await evictFreshProjectsUntilHealthy(cloudBacked, initialUsage)
            : 0;

        const finalPct = quota > 0 ? Math.round((usage / quota) * 100) : 0;
        ({ usage = 0, quota = 0 } = await navigator.storage.estimate());
        console.log(
            `[StorageCleanup] Complete — freed ${fmt(initialUsage - usage)}, ` +
            `now ${fmt(usage)} / ${fmt(quota)} (${finalPct}%), ` +
            `evicted ${evictedStale + evictedFresh} project(s), ` +
            `deleted ${orphanedBlobs} orphan blob(s), ${orphanedProjects} orphan project(s)`,
        );
    } catch (err) {
        console.error('[StorageCleanup] Cleanup failed:', err);
    } finally {
        running = false;
    }
}
