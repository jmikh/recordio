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
export function getProjectScreenPath(projectData: any): string | null {
    return projectData?.screenSource?.storagePath ?? null;
}

// deno-lint-ignore no-explicit-any
export function getProjectCameraPath(projectData: any): string | null {
    return projectData?.cameraSource?.storagePath ?? null;
}

// deno-lint-ignore no-explicit-any
export function getProjectMicPath(projectData: any): string | null {
    return projectData?.microphoneSource?.storagePath ?? null;
}

// deno-lint-ignore no-explicit-any
export function getProjectBackgroundPath(projectData: any): string | null {
    return projectData?.settings?.background?.storagePath ?? null;
}

// deno-lint-ignore no-explicit-any
export function getProjectMusicPath(projectData: any): string | null {
    return projectData?.settings?.audio?.music?.storagePath ?? null;
}

// deno-lint-ignore no-explicit-any
export function getProjectMediaPaths(projectData: any): MediaEntry[] {
    const entries: MediaEntry[] = [];

    const screen = getProjectScreenPath(projectData);
    if (screen) entries.push({ storagePath: screen, type: 'screen' });

    const camera = getProjectCameraPath(projectData);
    if (camera) entries.push({ storagePath: camera, type: 'camera' });

    const mic = getProjectMicPath(projectData);
    if (mic) entries.push({ storagePath: mic, type: 'mic' });

    const background = getProjectBackgroundPath(projectData);
    if (background) entries.push({ storagePath: background, type: 'background' });

    const music = getProjectMusicPath(projectData);
    if (music) entries.push({ storagePath: music, type: 'music' });

    return entries;
}
