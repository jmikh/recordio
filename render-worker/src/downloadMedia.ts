/**
 * Download project media files from signed URLs to a local temp directory.
 *
 * mediaUrls is keyed by storagePath (e.g. "userId/projectId/screen.webm" → signedUrl).
 * Returns a map of storagePath → local filename so the render page can resolve them.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** storagePath → signed download URL */
export type MediaUrls = Record<string, string>;

/** storagePath → local filename written to tmpDir */
export type MediaFileNames = Record<string, string>;

export async function downloadMedia(
    mediaUrls: MediaUrls,
    projectData: { settings?: { audio?: { music?: { enabled?: boolean; source?: string; presetUrl?: string } } } },
    tmpDir: string,
): Promise<MediaFileNames> {
    const downloads: Array<{ storagePath: string; localName: string; url: string }> = [];

    for (const [storagePath, signedUrl] of Object.entries(mediaUrls)) {
        // Use the last segment of the storagePath as local filename (e.g. "screen.webm")
        const localName = path.basename(storagePath);
        downloads.push({ storagePath, localName, url: signedUrl });
    }

    // Background music (CDN preset URL — download directly)
    const music = projectData.settings?.audio?.music;
    if (music?.enabled && music.source === 'preset' && music.presetUrl) {
        const musicUrl = music.presetUrl;
        console.log(`[Render] Downloading preset music from CDN: ${musicUrl}`);
        const resp = await fetch(musicUrl);
        if (resp.ok) {
            const buffer = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(path.join(tmpDir, `music${getExt(musicUrl)}`), buffer);
            console.log(`[Render] ✓ Music downloaded (${(buffer.length / 1024).toFixed(0)} KB)`);
        } else {
            console.warn(`[Render] Failed to download music: ${resp.status}`);
        }
    }

    // Download all media from signed URLs in parallel
    await Promise.all(downloads.map(async (dl) => {
        console.log(`[Render] Downloading ${dl.localName} (${dl.storagePath})`);
        const resp = await fetch(dl.url);
        if (!resp.ok) {
            throw new Error(`Failed to download ${dl.storagePath}: ${resp.status} ${resp.statusText}`);
        }

        const buffer = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(path.join(tmpDir, dl.localName), buffer);
        console.log(`[Render] ✓ ${dl.localName} downloaded (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    }));

    const fileNames: MediaFileNames = {};
    for (const dl of downloads) {
        fileNames[dl.storagePath] = dl.localName;
    }
    return fileNames;
}

function getExt(urlOrPath: string): string {
    try {
        const ext = path.extname(new URL(urlOrPath).pathname);
        return ext || '.webm';
    } catch {
        const ext = path.extname(urlOrPath);
        return ext || '.webm';
    }
}
