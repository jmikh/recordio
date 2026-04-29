/**
 * Local test route for server-side rendering.
 *
 * POST /render — receives project data + quality, downloads media from
 * Supabase Storage, runs the render pipeline, writes MP4 to /tmp/.
 * Progress is logged to the backend console. Not for production use.
 */

import type { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { authenticateRequest } from '../middleware/auth.js';
import { supabase } from '../middleware/auth.js';
import { renderViaPlaywright, type MediaFileNames } from './playwrightRender.js';
import type { ExportQuality } from '@shared/utils/exportQuality';
import type { Project } from '@shared/types/project';

export async function renderRoute(app: FastifyInstance) {
    app.post('/render', async (request, reply) => {
        const user = await authenticateRequest(request, reply);
        if (!user) return; // reply already sent

        const { projectData, quality } = request.body as {
            projectData: Project;
            quality: ExportQuality;
        };

        if (!projectData || !quality) {
            return reply.code(400).send({ ok: false, error: 'Missing projectData or quality' });
        }

        // Create temp directory for this render
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recordio-render-'));
        console.log(`[Render] Starting render job in ${tmpDir}`);
        console.log(`[Render] Quality: ${quality}, Project: ${projectData.id}`);

        try {
            // Fetch storage paths from the project table
            const { data: row, error: dbError } = await supabase
                .from('projects')
                .select('screen_storage_path, camera_storage_path, mic_storage_path')
                .eq('id', projectData.id)
                .maybeSingle();

            if (dbError || !row) {
                return reply.code(404).send({ ok: false, error: `Project not found in cloud: ${dbError?.message ?? 'no row'}` });
            }

            // Download media from Supabase Storage
            const mediaFileNames = await downloadMedia(row, projectData, tmpDir);

            // Run render via headless browser
            const result = await renderViaPlaywright({
                project: projectData,
                quality,
                mediaDir: tmpDir,
                mediaFileNames,
                onProgress: (phase, progress, message) => {
                    console.log(`[Render] [${phase}] ${(progress * 100).toFixed(1)}% — ${message}`);
                },
            });

            console.log(`[Render] ✓ Complete! Output: ${result.outputPath}`);
            return reply.send({
                ok: true,
                outputPath: result.outputPath,
                durationMs: result.durationMs,
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[Render] ✗ Failed:`, message);
            return reply.code(500).send({ ok: false, error: message });
        }
    });
}

/**
 * Download project media files from Supabase Storage to the temp directory.
 */
async function downloadMedia(
    row: { screen_storage_path: string | null; camera_storage_path: string | null; mic_storage_path: string | null },
    project: Project,
    tmpDir: string,
): Promise<MediaFileNames> {
    const downloads: Array<{ name: string; storagePath: string }> = [];

    if (row.screen_storage_path && row.screen_storage_path !== 'pending') {
        downloads.push({ name: `screen${getExt(row.screen_storage_path)}`, storagePath: row.screen_storage_path });
    }
    if (row.camera_storage_path && row.camera_storage_path !== 'pending') {
        downloads.push({ name: `camera${getExt(row.camera_storage_path)}`, storagePath: row.camera_storage_path });
    }
    if (row.mic_storage_path && row.mic_storage_path !== 'pending') {
        downloads.push({ name: `mic${getExt(row.mic_storage_path)}`, storagePath: row.mic_storage_path });
    }

    // Background music (CDN preset URL — download directly)
    const music = project.settings.audio?.music;
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

    // Download from Supabase Storage
    for (const dl of downloads) {
        console.log(`[Render] Downloading ${dl.name} from storage: ${dl.storagePath}`);
        const { data, error } = await supabase.storage
            .from('project-media')
            .download(dl.storagePath);

        if (error || !data) {
            throw new Error(`Failed to download ${dl.name}: ${error?.message ?? 'no data'}`);
        }

        const buffer = Buffer.from(await data.arrayBuffer());
        fs.writeFileSync(path.join(tmpDir, dl.name), buffer);
        console.log(`[Render] ✓ ${dl.name} downloaded (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    }

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
