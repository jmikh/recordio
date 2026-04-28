/**
 * Download project media files from signed URLs to a local temp directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MediaFileNames } from './playwrightRender.js';

export interface MediaUrls {
    screen?: string;
    camera?: string;
    mic?: string;
}

export async function downloadMedia(
    mediaUrls: MediaUrls,
    projectData: { settings?: { audio?: { music?: { enabled?: boolean; source?: string; presetUrl?: string } } } },
    tmpDir: string,
): Promise<MediaFileNames> {
    const downloads: Array<{ name: string; url: string }> = [];

    if (mediaUrls.screen) {
        downloads.push({ name: `screen${getExt(mediaUrls.screen)}`, url: mediaUrls.screen });
    }
    if (mediaUrls.camera) {
        downloads.push({ name: `camera${getExt(mediaUrls.camera)}`, url: mediaUrls.camera });
    }
    if (mediaUrls.mic) {
        downloads.push({ name: `mic${getExt(mediaUrls.mic)}`, url: mediaUrls.mic });
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
        console.log(`[Render] Downloading ${dl.name}`);
        const resp = await fetch(dl.url);
        if (!resp.ok) {
            throw new Error(`Failed to download ${dl.name}: ${resp.status} ${resp.statusText}`);
        }

        const buffer = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(path.join(tmpDir, dl.name), buffer);
        console.log(`[Render] ✓ ${dl.name} downloaded (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    }));

    const fileNames: MediaFileNames = {};
    for (const dl of downloads) {
        if (dl.name.startsWith('screen')) fileNames.screen = dl.name;
        else if (dl.name.startsWith('camera')) fileNames.camera = dl.name;
        else if (dl.name.startsWith('mic')) fileNames.mic = dl.name;
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
