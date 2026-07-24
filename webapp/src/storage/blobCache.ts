import { CloudStorage } from './cloudStorage';

const CACHE_NAME = 'recordio-media-v1';

/**
 * Cache API wrapper for local blob caching.
 *
 * Blobs are keyed by their cloud storage path. On cache miss,
 * downloads from Supabase Storage via CloudStorage. The browser
 * manages eviction under storage pressure automatically.
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
     * Returns from cache if available, otherwise downloads from cloud and caches.
     * Concurrent calls for the same path share a single download.
     *
     * `knownUrl`: a ready-to-fetch download URL the caller already holds
     * (the asset_list enrichment) — on cache miss it is fetched directly
     * instead of round-tripping the path through /storage-download-urls.
     */
    static async getBlob(
        storagePath: string,
        onProgress?: (fraction: number) => void,
        knownUrl?: string,
    ): Promise<Blob> {
        const tag = storagePath.split('/').pop() ?? storagePath;

        // Deduplicate: if already downloading this path, piggyback on the existing request
        const existing = this.inflight.get(storagePath);
        if (existing) {
            console.log(`[BlobCache] ${tag}: joining in-flight download`);
            return existing;
        }

        const promise = this._getBlob(storagePath, tag, onProgress, knownUrl);
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
        onProgress?: (fraction: number) => void,
        knownUrl?: string,
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

        // Cache miss — download from cloud
        console.log(`[BlobCache] ${tag}: cache miss, downloading…`);
        const t1 = performance.now();
        const blob = knownUrl
            ? await CloudStorage.downloadBlob(knownUrl, onProgress)
            : await CloudStorage.downloadMediaFile(storagePath, onProgress);
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
        onProgress?: (fraction: number) => void,
        knownUrl?: string,
    ): Promise<string> {
        const blob = await this.getBlob(storagePath, onProgress, knownUrl);
        return URL.createObjectURL(blob);
    }

    /**
     * Get blob URLs for multiple paths, batching the signed URL request.
     * Checks cache first, then fetches signed URLs only for misses in a single call.
     * Paths present in `knownUrls` skip the signed-URL request entirely.
     */
    static async getBlobUrls(
        storagePaths: string[],
        knownUrls?: Record<string, string>,
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

        // Batch-fetch signed URLs only for misses without a known URL
        const needSigned = misses.filter((p) => !knownUrls?.[p]);
        let signedUrls: Record<string, string> = {};
        if (needSigned.length > 0) {
            console.log(`[BlobCache] fetching ${needSigned.length} signed URLs…`);
            const t0 = performance.now();
            signedUrls = await CloudStorage.requestDownloadUrls(needSigned);
            console.log(`[BlobCache] signed URLs obtained in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
        }

        // Download all misses in parallel — skip individual failures
        // so one missing thumbnail doesn't block the rest
        await Promise.all(
            misses.map(async (storagePath) => {
                try {
                    const tag = storagePath.split('/').pop() ?? storagePath;
                    const t1 = performance.now();
                    console.log(`[BlobCache] ${tag}: downloading…`);
                    const blob = await CloudStorage.downloadBlob(knownUrls?.[storagePath] ?? signedUrls[storagePath]);
                    console.log(`[BlobCache] ${tag}: downloaded ${(blob.size / 1e6).toFixed(1)}MB in ${((performance.now() - t1) / 1000).toFixed(1)}s`);

                    await cache.put(this.cacheKey(storagePath), new Response(blob));
                    result[storagePath] = URL.createObjectURL(blob);
                } catch (err) {
                    console.warn(`[BlobCache] ${storagePath.split('/').pop()}: download failed, skipping`, err);
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
