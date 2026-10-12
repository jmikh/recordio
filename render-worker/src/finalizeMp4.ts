/**
 * Post-processes the browser's MP4 before upload so it plays everywhere.
 *
 * The worker's Linux Chromium has no AAC encoder, so ExportManager falls back
 * to Opus audio. Opus-in-MP4 plays in browsers and on YouTube but not in
 * Windows Media Player. We probe the file and re-encode only non-AAC audio to
 * AAC — video is always stream-copied — and move the moov atom to the front
 * (+faststart) so playback can start before the whole file has downloaded.
 */

import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface StreamCodecs {
    video: string | null;
    audio: string | null;
}

export interface FinalizeResult {
    filePath: string;
    codecs: StreamCodecs;
    audioTranscoded: boolean;
    durationMs: number;
}

/** Read the first video and audio stream codec names (ffprobe naming, e.g. h264, opus, aac). */
export async function probeCodecs(filePath: string): Promise<StreamCodecs> {
    const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,codec_name',
        '-of', 'json',
        filePath,
    ]);
    const streams = (JSON.parse(stdout).streams ?? []) as { codec_type: string; codec_name: string }[];
    return {
        video: streams.find(s => s.codec_type === 'video')?.codec_name ?? null,
        audio: streams.find(s => s.codec_type === 'audio')?.codec_name ?? null,
    };
}

/** Write a finalized copy of `inputPath` next to it and return its path. */
export async function finalizeMp4(inputPath: string): Promise<FinalizeResult> {
    const start = Date.now();
    const codecs = await probeCodecs(inputPath);
    const audioTranscoded = codecs.audio !== null && codecs.audio !== 'aac';
    const outputPath = path.join(path.dirname(inputPath), 'final.mp4');

    try {
        await execFileAsync('ffmpeg', [
            '-v', 'error', '-y',
            '-i', inputPath,
            '-map', '0',
            '-c', 'copy',
            ...(audioTranscoded ? ['-c:a', 'aac', '-b:a', '128k'] : []),
            '-movflags', '+faststart',
            outputPath,
        ]);
    } catch (err) {
        const stderr = (err as { stderr?: string }).stderr?.trim();
        throw new Error(`ffmpeg failed: ${stderr || (err as Error).message}`);
    }

    return { filePath: outputPath, codecs, audioTranscoded, durationMs: Date.now() - start };
}
