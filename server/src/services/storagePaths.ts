/**
 * Object keys in the project-media bucket — the one place they're built
 * (and recognized). Routes and jobs call these instead of templating
 * `${id}/…` themselves.
 *
 * Every key lives under exactly one owner prefix:
 *   - projects:    `${created_by}/${projectId}/`              recording media, attached assets, thumbnail, renders
 *   - screenshots: `${created_by}/screenshots/${screenshotId}/` source, thumbnail, renders
 *   - library:     `${userId}/assets/`                        the user's background/music uploads
 *
 * Project and screenshot keys take the row's created_by, never the
 * caller: whoever uploads, the object lands under the prefix the purge
 * jobs delete (projectsPurgeDeleted / screenshotsPurgeDeleted).
 */
import type { ExportFps, ExportQuality } from '@shared/utils/exportQuality';

/** File extension per project media slot (the editor-generated camera matte included). */
const PROJECT_MEDIA_EXT = {
    screen: 'webm',
    camera: 'webm',
    mic: 'wav',
    cameraMatte: 'webm',
} as const;

export type ProjectMediaType = keyof typeof PROJECT_MEDIA_EXT;

// ─── User ────────────────────────────────────────────────────

/** Root of everything stored under a user — what /storage-download-urls checks against. */
export function userStoragePrefix(userId: string): string {
    return `${userId}/`;
}

/** A library asset (background/music) the user uploaded. */
export function userAssetPath(userId: string, assetId: string, ext: string): string {
    return `${userStoragePrefix(userId)}assets/${assetId}.${ext}`;
}

/** Whether `path` is a well-formed key under the user's own prefix. */
export function isUserPath(path: string, userId: string): boolean {
    const segments = keySegments(path);
    return segments !== null && segments.length >= 2 && segments[0] === userId;
}

// ─── Project ─────────────────────────────────────────────────

export function projectStoragePrefix(createdBy: string, projectId: string): string {
    return `${userStoragePrefix(createdBy)}${projectId}/`;
}

export function projectMediaPath(createdBy: string, projectId: string, type: ProjectMediaType): string {
    return `${projectStoragePrefix(createdBy, projectId)}${type}.${PROJECT_MEDIA_EXT[type]}`;
}

export function projectThumbnailPath(createdBy: string, projectId: string): string {
    return `${projectStoragePrefix(createdBy, projectId)}thumbnail.webp`;
}

/**
 * A library asset copied into the project (background/music). `fileName`
 * is the source's last segment (`<assetId>.<ext>`), so re-attaching the
 * same asset lands on the same key.
 */
export function projectAssetPath(createdBy: string, projectId: string, fileName: string): string {
    return `${projectStoragePrefix(createdBy, projectId)}assets/${fileName}`;
}

/**
 * Whether `path` is a well-formed key inside the project's namespace
 * (`<anyUser>/<projectId>/…`). The first segment isn't pinned to
 * created_by: a collaborator's camera matte and renders sit under their
 * own prefix, still scoped to this project.
 */
export function isProjectPath(path: string, projectId: string): boolean {
    const segments = keySegments(path);
    return segments !== null && segments.length >= 3 && segments[1] === projectId;
}

/** Last segment of a key — the file name a copy keeps. */
export function storageFileName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * A cloud render; the name carries every part of the render cache key.
 *
 * `prefixOwner` is the requesting user, not created_by — the one
 * exception to the rule above. Renders are downloaded through
 * /storage-download-urls, which only signs the caller's own prefix, so
 * a render under the creator's prefix would 403 a collaborator. Move it
 * once that route authorizes by project access instead of prefix.
 */
export function projectRenderPath(
    prefixOwner: string,
    projectId: string,
    render: { cloudVersion: number; quality: ExportQuality; fps: ExportFps },
): string {
    const { cloudVersion, quality, fps } = render;
    return `${projectStoragePrefix(prefixOwner, projectId)}renders/v${cloudVersion}_${quality}_${fps}fps.mp4`;
}

// ─── Screenshot ──────────────────────────────────────────────

export function screenshotStoragePrefix(createdBy: string, screenshotId: string): string {
    return `${userStoragePrefix(createdBy)}screenshots/${screenshotId}/`;
}

export function screenshotSourcePath(createdBy: string, screenshotId: string): string {
    return `${screenshotStoragePrefix(createdBy, screenshotId)}source.png`;
}

export function screenshotThumbnailPath(createdBy: string, screenshotId: string): string {
    return `${screenshotStoragePrefix(createdBy, screenshotId)}thumbnail.webp`;
}

/** The flattened PNG the public page serves, keyed by the cloud version it was rendered from. */
export function screenshotRenderPath(createdBy: string, screenshotId: string, cloudVersion: number): string {
    return `${screenshotStoragePrefix(createdBy, screenshotId)}renders/v${cloudVersion}.png`;
}

// ─── Recognition ─────────────────────────────────────────────

/** A key's segments, or null when it could escape its prefix (empty, `.` or `..` segments). */
function keySegments(path: string): string[] | null {
    const segments = path.split('/');
    return segments.every(s => s !== '' && s !== '.' && s !== '..') ? segments : null;
}
