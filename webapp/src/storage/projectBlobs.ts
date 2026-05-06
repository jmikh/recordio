import type { Project } from '@shared/types';
import { BlobCache } from './blobCache';
import { getProjectMediaPaths } from '@shared/utils/projectMedia';

// Re-export shared utilities so existing imports don't break
export { cloudStoragePath, getProjectMediaPaths } from '@shared/utils/projectMedia';
export type { MediaEntry } from '@shared/utils/projectMedia';

/**
 * Hydrate all media blob URLs into the provided setUrl callback.
 * Downloads all media in parallel from cloud on cache miss via BlobCache.
 */
export async function hydrateMediaUrls(
    project: Project,
    setUrl: (storagePath: string, url: string) => void,
    onStatus?: (status: string) => void,
): Promise<void> {
    const entries = getProjectMediaPaths(project);
    onStatus?.('Loading Project');

    console.log(`[hydrate] loading ${entries.length} media files…`);
    const t0 = performance.now();

    const blobUrls = await BlobCache.getBlobUrls(entries.map((e) => e.storagePath));

    for (const [storagePath, blobUrl] of Object.entries(blobUrls)) {
        setUrl(storagePath, blobUrl);
    }

    console.log(`[hydrate] all media loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}
