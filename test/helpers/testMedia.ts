/**
 * Generate minimal test media files using ffmpeg.
 *
 * Creates tiny valid webm/wav files for render worker testing.
 * Files are cached in os.tmpdir() so ffmpeg only runs once per test suite.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const CACHE_DIR = path.join(os.tmpdir(), 'recordio-test-media');

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

/** 1-second blue screen webm (VP8, 320x240, no audio). */
export function getTestScreenWebm(): string {
    ensureCacheDir();
    const out = path.join(CACHE_DIR, 'test-screen.webm');
    if (!fs.existsSync(out)) {
        execSync(
            `ffmpeg -y -f lavfi -i "color=c=blue:s=320x240:d=1:r=30" -c:v libvpx -b:v 200k -auto-alt-ref 0 "${out}"`,
            { stdio: 'pipe' },
        );
    }
    return out;
}

/** 1-second webm with audio (screen + system audio simulation). */
export function getTestScreenWithAudioWebm(): string {
    ensureCacheDir();
    const out = path.join(CACHE_DIR, 'test-screen-audio.webm');
    if (!fs.existsSync(out)) {
        execSync(
            `ffmpeg -y -f lavfi -i "color=c=blue:s=320x240:d=1:r=30" -f lavfi -i "sine=f=440:d=1" -c:v libvpx -b:v 200k -auto-alt-ref 0 -c:a libvorbis "${out}"`,
            { stdio: 'pipe' },
        );
    }
    return out;
}

/** 1-second silent wav (mono, 44100 Hz). */
export function getTestMicWav(): string {
    ensureCacheDir();
    const out = path.join(CACHE_DIR, 'test-mic.wav');
    if (!fs.existsSync(out)) {
        execSync(
            `ffmpeg -y -f lavfi -i "anullsrc=r=44100:cl=mono" -t 1 "${out}"`,
            { stdio: 'pipe' },
        );
    }
    return out;
}
