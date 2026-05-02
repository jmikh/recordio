/**
 * Upload the rendered MP4 to Supabase Storage via signed upload URL PUT.
 */

import * as fs from 'node:fs';

const MAX_RETRIES = 3;

export async function uploadResult(
    filePath: string,
    uploadUrl: string,
    onProgress?: (fraction: number) => void,
): Promise<void> {
    const fileBuffer = fs.readFileSync(filePath);
    const fileSize = fileBuffer.byteLength;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            onProgress?.(0);

            const resp = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'video/mp4',
                },
                body: fileBuffer,
            });

            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`Upload failed: ${resp.status} ${text}`);
            }

            onProgress?.(1);
            console.log(`[Upload] ✓ Uploaded ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
            return;
        } catch (err) {
            if (attempt === MAX_RETRIES) {
                throw err;
            }
            const delay = attempt * 2000;
            console.warn(`[Upload] Attempt ${attempt} failed, retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}
