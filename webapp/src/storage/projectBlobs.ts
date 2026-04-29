import type { Project } from '../types';
import { BlobCache } from './blobCache';
import { getProjectMediaPaths } from '@shared/utils/projectMedia';

// Re-export shared utilities so existing imports don't break
export { cloudStoragePath, getProjectMediaPaths } from '@shared/utils/projectMedia';
export type { MediaEntry } from '@shared/utils/projectMedia';

const STATUS_LABELS: Record<string, string> = {
    screen: 'Loading screen recording...',
    camera: 'Loading camera...',
    mic: 'Loading audio...',
    background: 'Loading background...',
    music: 'Loading music...',
};

/**
 * Hydrate all media blob URLs into the provided setUrl callback.
 * Downloads from cloud on cache miss via BlobCache.
 */
export async function hydrateMediaUrls(
    project: Project,
    setUrl: (storagePath: string, url: string) => void,
    onStatus?: (status: string) => void,
): Promise<void> {
    for (const entry of getProjectMediaPaths(project)) {
        onStatus?.(STATUS_LABELS[entry.type] ?? 'Loading media...');
        const blobUrl = await BlobCache.getBlobUrl(entry.storagePath);
        setUrl(entry.storagePath, blobUrl);
    }
}
