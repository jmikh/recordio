import type { Project } from '../types/project';

/** File type to extension mapping (matches storage-upload-url edge function). */
const EXT_MAP: Record<string, string> = {
    screen: 'webm',
    camera: 'webm',
    mic: 'wav',
    thumbnail: 'webp',
};

export type MediaFileType = 'screen' | 'camera' | 'mic' | 'thumbnail';

/**
 * Compute the deterministic cloud storage path for a media file.
 * Must match the pattern in storage-upload-url edge function:
 *   ${userId}/${projectId}/${fileType}.${ext}
 */
export function cloudStoragePath(
    userId: string,
    projectId: string,
    fileType: MediaFileType,
): string {
    return `${userId}/${projectId}/${fileType}.${EXT_MAP[fileType]}`;
}

export type MediaEntryType = 'screen' | 'camera' | 'mic' | 'background' | 'music';

/** Entry returned by getProjectMediaPaths(). */
export interface MediaEntry {
    storagePath: string;
    type: MediaEntryType;
}

/**
 * Extract all media storage paths from a project.
 *
 * This is the single source of truth for "what blobs does a project need?"
 * Used by: webapp (BlobCache hydration), edge functions (signed URL generation),
 * render worker (media download), and export (project transfer).
 *
 * When new media types are added to the project, add them here and all
 * consumers pick them up automatically.
 *
 * // TODO: Also update the Deno copy at webapp/supabase/functions/_shared/projectMedia.ts
 */
export function getProjectMediaPaths(project: Project): MediaEntry[] {
    const entries: MediaEntry[] = [];

    entries.push({
        storagePath: project.screenSource.storagePath,
        type: 'screen',
    });

    if (project.cameraSource) {
        entries.push({
            storagePath: project.cameraSource.storagePath,
            type: 'camera',
        });
    }

    if (project.microphoneSource) {
        entries.push({
            storagePath: project.microphoneSource.storagePath,
            type: 'mic',
        });
    }

    if (project.settings?.background?.storagePath) {
        entries.push({
            storagePath: project.settings.background.storagePath,
            type: 'background',
        });
    }

    if (project.settings?.audio?.music?.storagePath) {
        entries.push({
            storagePath: project.settings.audio.music.storagePath,
            type: 'music',
        });
    }

    return entries;
}
