/**
 * Media-path extraction from project_data — ports
 * `_shared/projectMedia.ts#getProjectMediaPaths` (landed with
 * render-job-create; mux-video-create will reuse it in Wave B #9).
 *
 * Third copy of this logic (webapp `shared/utils/projectMedia.ts`, the
 * Deno `_shared` copy, now this) — consolidation is logged in
 * suggested_changes.md for when the Deno copy dies.
 *
 * project_data is the arbitrary editor struct (stored verbatim by
 * project-create-v2) — typed loosely on purpose.
 */

export type MediaEntryType = 'screen' | 'camera' | 'mic' | 'background' | 'music';

export interface MediaEntry {
    storagePath: string;
    type: MediaEntryType;
}

interface ProjectDataShape {
    screenSource?: { storagePath?: string };
    cameraSource?: { storagePath?: string };
    microphoneSource?: { storagePath?: string };
    settings?: {
        background?: { storagePath?: string };
        audio?: { music?: { storagePath?: string } };
    };
}

/** Mic-audio path only (transcribe) — null when the project has none. */
export function getProjectMicPath(projectData: unknown): string | null {
    const data = (projectData ?? {}) as ProjectDataShape;
    return data.microphoneSource?.storagePath ?? null;
}

export function getProjectMediaPaths(projectData: unknown): MediaEntry[] {
    const data = (projectData ?? {}) as ProjectDataShape;
    const entries: MediaEntry[] = [];

    const push = (storagePath: string | undefined, type: MediaEntryType) => {
        if (storagePath) entries.push({ storagePath, type });
    };

    push(data.screenSource?.storagePath, 'screen');
    push(data.cameraSource?.storagePath, 'camera');
    push(data.microphoneSource?.storagePath, 'mic');
    push(data.settings?.background?.storagePath, 'background');
    push(data.settings?.audio?.music?.storagePath, 'music');

    return entries;
}
