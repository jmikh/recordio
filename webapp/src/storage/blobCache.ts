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

    private static cacheKey(storagePath: string): string {
        return `${this.KEY_PREFIX}${storagePath}`;
    }

    /**
     * Get a blob by cloud storage path.
     * Returns from cache if available, otherwise downloads from cloud and caches.
     */
    static async getBlob(
        storagePath: string,
        onProgress?: (fraction: number) => void,
    ): Promise<Blob> {
        const cache = await caches.open(CACHE_NAME);
        const key = this.cacheKey(storagePath);

        const cached = await cache.match(key);
        if (cached) {
            return cached.blob();
        }

        // Cache miss — download from cloud
        const blob = await CloudStorage.downloadMediaFile(storagePath, onProgress);
        await cache.put(key, new Response(blob));
        return blob;
    }

    /**
     * Get a blob URL (cache-or-download, then createObjectURL).
     * Caller is responsible for revoking the URL when done.
     */
    static async getBlobUrl(
        storagePath: string,
        onProgress?: (fraction: number) => void,
    ): Promise<string> {
        const blob = await this.getBlob(storagePath, onProgress);
        return URL.createObjectURL(blob);
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

    /** Evict a single cache entry. */
    static async evict(storagePath: string): Promise<void> {
        const cache = await caches.open(CACHE_NAME);
        await cache.delete(this.cacheKey(storagePath));
    }
}
