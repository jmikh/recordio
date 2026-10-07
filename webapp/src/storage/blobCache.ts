import { CloudStorage } from './cloudStorage';

const CACHE_NAME = 'recordio-media-v1';

/**
 * Cache API wrapper for local blob caching.
 *
 * Blobs are keyed by their cloud storage path. On cache miss they are
 * downloaded from a presigned URL the caller already holds — handed out by
 * the server route that authorized the resource (project-get, project-list,
 * screenshot-get, screenshot-list, asset-list, project-asset-attach). There
 * is no way to sign an arbitrary path, so a miss without a URL is a miss.
 * The browser manages eviction under storage pressure automatically.
 */
export class BlobCache {
    /** Synthetic URL prefix used as Cache API key (never fetched over network). */
    private static KEY_PREFIX = '/_media/';

    /** In-flight download promises — deduplicates concurrent requests for the same path. */
    private static inflight = new Map<string, Promise<Blob>>();

    private static cacheKey(storagePath: string): string {
        return `${this.KEY_PREFIX}${storagePath}`;
    }

    /**
     * Get a blob by cloud storage path.
     * Returns from cache if available, otherwise downloads `url` and caches.
     * Throws on a miss without a URL. Concurrent calls for the same path
     * share a single download.
     */
    static async getBlob(
        storagePath: string,
        url: string | undefined,
        onProgress?: (fraction: number) => void,
    ): Promise<Blob> {
        const tag = storagePath.split('/').pop() ?? storagePath;

        // Deduplicate: if already downloading this path, piggyback on the existing request
        const existing = this.inflight.get(storagePath);
        if (existing) {
            console.log(`[BlobCache] ${tag}: joining in-flight download`);
            return existing;
        }

        const promise = this._getBlob(storagePath, tag, url, onProgress);
        this.inflight.set(storagePath, promise);
        try {
            return await promise;
        } finally {
            this.inflight.delete(storagePath);
        }
    }

    private static async _getBlob(
        storagePath: string,
        tag: string,
        url: string | undefined,
        onProgress?: (fraction: number) => void,
    ): Promise<Blob> {
        const t0 = performance.now();

        const cache = await caches.open(CACHE_NAME);
        const key = this.cacheKey(storagePath);

        const cached = await cache.match(key);
        if (cached) {
            const blob = await cached.blob();
            console.log(`[BlobCache] ${tag}: cache hit (${(blob.size / 1e6).toFixed(1)}MB) in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
            return blob;
        }

        // Cache miss — download from the URL the caller was handed
        if (!url) throw new Error(`[BlobCache] ${tag}: not cached and no download URL`);
        console.log(`[BlobCache] ${tag}: cache miss, downloading…`);
        const t1 = performance.now();
        const blob = await CloudStorage.downloadBlob(url, onProgress);
        console.log(`[BlobCache] ${tag}: downloaded ${(blob.size / 1e6).toFixed(1)}MB in ${((performance.now() - t1) / 1000).toFixed(1)}s`);

        const t2 = performance.now();
        await cache.put(key, new Response(blob));
        console.log(`[BlobCache] ${tag}: cached in ${((performance.now() - t2) / 1000).toFixed(1)}s`);

        console.log(`[BlobCache] ${tag}: total ${((performance.now() - t0) / 1000).toFixed(1)}s`);
        return blob;
    }

    /**
     * Get a blob URL (cache-or-download, then createObjectURL).
     * Caller is responsible for revoking the URL when done.
     */
    static async getBlobUrl(
        storagePath: string,
        url: string | undefined,
        onProgress?: (fraction: number) => void,
    ): Promise<string> {
        const blob = await this.getBlob(storagePath, url, onProgress);
        return URL.createObjectURL(blob);
    }

    /**
     * Get blob URLs for multiple paths: cache first, then misses are
     * downloaded in parallel from `urls`. Paths that fail — or miss with no
     * URL — are left out of the result rather than failing the batch.
     */
    static async getBlobUrls(
        storagePaths: string[],
        urls: Record<string, string>,
    ): Promise<Record<string, string>> {
        const result: Record<string, string> = {};
        const cache = await caches.open(CACHE_NAME);
        const misses: string[] = [];

        // Check cache for all paths
        await Promise.all(
            storagePaths.map(async (storagePath) => {
                const tag = storagePath.split('/').pop() ?? storagePath;
                const t0 = performance.now();
                const cached = await cache.match(this.cacheKey(storagePath));
                if (cached) {
                    const blob = await cached.blob();
                    console.log(`[BlobCache] ${tag}: cache hit (${(blob.size / 1e6).toFixed(1)}MB) in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
                    result[storagePath] = URL.createObjectURL(blob);
                } else {
                    misses.push(storagePath);
                }
            }),
        );

        if (misses.length === 0) return result;

        // Download all misses in parallel — skip individual failures
        // so one missing thumbnail doesn't block the rest
        await Promise.all(
            misses.map(async (storagePath) => {
                const tag = storagePath.split('/').pop() ?? storagePath;
                const url = urls[storagePath];
                if (!url) {
                    console.warn(`[BlobCache] ${tag}: not cached and no download URL, skipping`);
                    return;
                }
                try {
                    const t1 = performance.now();
                    console.log(`[BlobCache] ${tag}: downloading…`);
                    const blob = await CloudStorage.downloadBlob(url);
                    console.log(`[BlobCache] ${tag}: downloaded ${(blob.size / 1e6).toFixed(1)}MB in ${((performance.now() - t1) / 1000).toFixed(1)}s`);

                    await cache.put(this.cacheKey(storagePath), new Response(blob));
                    result[storagePath] = URL.createObjectURL(blob);
                } catch (err) {
                    console.warn(`[BlobCache] ${tag}: download failed, skipping`, err);
                }
            }),
        );

        return result;
    }

    /**
     * Write a blob to cache without downloading.
     * Used during recording import: blobs are already in memory,
     * so we cache them alongside the cloud upload to avoid re-downloading
     * when the editor opens.
     */
    static async put(storagePath: string, blob: Blob): Promise<void> {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(this.cacheKey(storagePath), new Response(blob));
    }

    /** Check if a blob is cached locally. */
    static async has(storagePath: string): Promise<boolean> {
        const cache = await caches.open(CACHE_NAME);
        const match = await cache.match(this.cacheKey(storagePath));
        return !!match;
    }

    /** Get a cached blob without falling back to a network download. */
    static async getBlobIfCached(storagePath: string): Promise<Blob | null> {
        const cache = await caches.open(CACHE_NAME);
        const match = await cache.match(this.cacheKey(storagePath));
        return match ? await match.blob() : null;
    }

    /** Evict a single cache entry. */
    static async evict(storagePath: string): Promise<void> {
        const cache = await caches.open(CACHE_NAME);
        await cache.delete(this.cacheKey(storagePath));
    }
}
