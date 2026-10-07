/**
 * Presigned GET URLs for the client. Signing happens only in routes that
 * have just checked access to the resource the files belong to
 * (project-get, project-list, screenshot-get, screenshot-list,
 * render-job-get-status, asset-list) — there is no endpoint that signs
 * an arbitrary path. Presigning is local HMAC, no network.
 */
import type { S3Port } from '../ports/s3.js';

/** URLs are consumed right after the response; a late miss refetches the owning route. */
export const DOWNLOAD_URL_TTL_SECONDS = 3600;

/** storagePath → presigned URL, deduped. */
export async function presignDownloads(s3: S3Port, paths: Iterable<string>): Promise<Record<string, string>> {
    const unique = [...new Set(paths)];
    const entries = await Promise.all(
        unique.map(async path => [path, await s3.presignDownload(path, DOWNLOAD_URL_TTL_SECONDS)] as const),
    );
    return Object.fromEntries(entries);
}
