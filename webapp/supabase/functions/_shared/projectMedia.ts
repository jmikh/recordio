/**
 * Extract all media storage paths from project_data JSON.
 *
 * This is a Deno-compatible copy of shared/utils/projectMedia.ts getProjectMediaPaths().
 * Supabase edge functions can't import from the shared/ directory, so we duplicate
 * the extraction logic here.
 *
 * // TODO: When adding new media types, also update shared/utils/projectMedia.ts
 */

export type MediaEntryType = 'screen' | 'camera' | 'mic' | 'background' | 'music';

export interface MediaEntry {
    storagePath: string;
    type: MediaEntryType;
}

// deno-lint-ignore no-explicit-any
export function getProjectMediaPaths(projectData: any): MediaEntry[] {
    const entries: MediaEntry[] = [];

    if (projectData?.screenSource?.storagePath) {
        entries.push({
            storagePath: projectData.screenSource.storagePath,
            type: 'screen',
        });
    }

    if (projectData?.cameraSource?.storagePath) {
        entries.push({
            storagePath: projectData.cameraSource.storagePath,
            type: 'camera',
        });
    }

    if (projectData?.microphoneSource?.storagePath) {
        entries.push({
            storagePath: projectData.microphoneSource.storagePath,
            type: 'mic',
        });
    }

    if (projectData?.settings?.background?.storagePath) {
        entries.push({
            storagePath: projectData.settings.background.storagePath,
            type: 'background',
        });
    }

    if (projectData?.settings?.audio?.music?.storagePath) {
        entries.push({
            storagePath: projectData.settings.audio.music.storagePath,
            type: 'music',
        });
    }

    return entries;
}
