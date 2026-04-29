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
 * // TODO: Also update the Deno copy at supabase/functions/_shared/projectMedia.ts
 */
export function getProjectScreenPath(project: Project): string | null {
    return project.screenSource?.storagePath ?? null;
}

export function getProjectCameraPath(project: Project): string | null {
    return project.cameraSource?.storagePath ?? null;
}

export function getProjectMicPath(project: Project): string | null {
    return project.microphoneSource?.storagePath ?? null;
}

export function getProjectBackgroundPath(project: Project): string | null {
    return project.settings?.background?.storagePath ?? null;
}

export function getProjectMusicPath(project: Project): string | null {
    return project.settings?.audio?.music?.storagePath ?? null;
}

export function getProjectMediaPaths(project: Project): MediaEntry[] {
    const entries: MediaEntry[] = [];

    const screen = getProjectScreenPath(project);
    if (screen) entries.push({ storagePath: screen, type: 'screen' });

    const camera = getProjectCameraPath(project);
    if (camera) entries.push({ storagePath: camera, type: 'camera' });

    const mic = getProjectMicPath(project);
    if (mic) entries.push({ storagePath: mic, type: 'mic' });

    const background = getProjectBackgroundPath(project);
    if (background) entries.push({ storagePath: background, type: 'background' });

    const music = getProjectMusicPath(project);
    if (music) entries.push({ storagePath: music, type: 'music' });

    return entries;
}
