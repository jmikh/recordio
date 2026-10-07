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
import { isProjectPath, projectMediaPath } from './storagePaths.js';

export type MediaEntryType = 'screen' | 'camera' | 'cameraMatte' | 'mic' | 'background' | 'music';

export interface MediaEntry {
    storagePath: string;
    type: MediaEntryType;
}

interface ProjectDataShape {
    screenSource?: { storagePath?: string };
    cameraSource?: { storagePath?: string; matte?: { storagePath?: string } };
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
    push(data.cameraSource?.matte?.storagePath, 'cameraMatte');
    push(data.microphoneSource?.storagePath, 'mic');
    push(data.settings?.background?.storagePath, 'background');
    push(data.settings?.audio?.music?.storagePath, 'music');

    return entries;
}

/**
 * Pre-v5 projects stored no storagePath on their recording sources — fill
 * in the deterministic paths, in place. Media lives under the creator's
 * prefix. (Was a client-side backfill in CloudProjectService.fetchProject.)
 */
export function backfillLegacyMediaPaths(projectData: unknown, createdBy: string, projectId: string): void {
    const data = (projectData ?? {}) as ProjectDataShape;
    if (data.screenSource && !data.screenSource.storagePath) {
        data.screenSource.storagePath = projectMediaPath(createdBy, projectId, 'screen');
    }
    if (data.cameraSource && !data.cameraSource.storagePath) {
        data.cameraSource.storagePath = projectMediaPath(createdBy, projectId, 'camera');
    }
    if (data.microphoneSource && !data.microphoneSource.storagePath) {
        data.microphoneSource.storagePath = projectMediaPath(createdBy, projectId, 'mic');
    }
}

/**
 * Media paths in `next` that a save may not introduce: anything outside
 * the project's namespace that the stored version (`previous`) didn't
 * already reference. Library assets enter a project only as copies made
 * by project-asset-attach / project-create-v2, so a foreign path can only
 * come from crafted input (or pre-migration data, which stays allowed
 * while unchanged).
 */
export function disallowedMediaPaths(next: unknown, previous: unknown, projectId: string): string[] {
    const known = new Set(getProjectMediaPaths(previous).map(e => e.storagePath));
    return getProjectMediaPaths(next)
        .map(e => e.storagePath)
        .filter(path => !known.has(path) && !isProjectPath(path, projectId));
}
