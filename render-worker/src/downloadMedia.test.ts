import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { downloadMedia, type MediaUrls } from './downloadMedia';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

// ── downloadMedia ──────────────────────────────────

describe('downloadMedia', () => {
    it('downloads files from signed URLs to tmpDir', async () => {
        const fakeContent = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]); // fake webm header
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(fakeContent, { status: 200 }),
        );

        const mediaUrls: MediaUrls = {
            'user1/proj1/screen.webm': 'https://example.com/signed/screen',
        };

        const result = await downloadMedia(mediaUrls, {}, tmpDir);

        expect(result['user1/proj1/screen.webm']).toBe('screen.webm');
        expect(fs.existsSync(path.join(tmpDir, 'screen.webm'))).toBe(true);
        expect(fs.readFileSync(path.join(tmpDir, 'screen.webm'))).toEqual(Buffer.from(fakeContent));
    });

    it('downloads multiple media files in parallel', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
            new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
        );

        const mediaUrls: MediaUrls = {
            'user1/proj1/screen.webm': 'https://example.com/screen',
            'user1/proj1/camera.webm': 'https://example.com/camera',
            'user1/proj1/mic.wav': 'https://example.com/mic',
        };

        const result = await downloadMedia(mediaUrls, {}, tmpDir);

        expect(Object.keys(result)).toHaveLength(3);
        expect(result['user1/proj1/screen.webm']).toBe('screen.webm');
        expect(result['user1/proj1/camera.webm']).toBe('camera.webm');
        expect(result['user1/proj1/mic.wav']).toBe('mic.wav');
        expect(fs.existsSync(path.join(tmpDir, 'screen.webm'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'camera.webm'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'mic.wav'))).toBe(true);
    });

    it('throws on HTTP error', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('Not Found', { status: 404, statusText: 'Not Found' }),
        );

        const mediaUrls: MediaUrls = {
            'user1/proj1/screen.webm': 'https://example.com/bad-url',
        };

        await expect(downloadMedia(mediaUrls, {}, tmpDir)).rejects.toThrow('Failed to download');
    });

    it('downloads preset music when enabled', async () => {
        const musicContent = new Uint8Array([0xff, 0xfb, 0x90]); // fake mp3 header
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(musicContent, { status: 200 }),
        );

        const projectData = {
            settings: {
                audio: {
                    music: {
                        enabled: true,
                        source: 'preset' as const,
                        presetUrl: 'https://cdn.example.com/music/track.mp3',
                    },
                },
            },
        };

        await downloadMedia({}, projectData, tmpDir);

        expect(fs.existsSync(path.join(tmpDir, 'music.mp3'))).toBe(true);
    });

    it('skips music download when not enabled', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            throw new Error('fetch should not be called');
        });

        const result = await downloadMedia({}, {
            settings: {
                audio: {
                    music: { enabled: false, source: 'preset' as const, presetUrl: 'https://cdn.example.com/track.mp3' },
                },
            },
        }, tmpDir);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(Object.keys(result)).toHaveLength(0);
    });

    it('handles empty mediaUrls', async () => {
        const result = await downloadMedia({}, {}, tmpDir);
        expect(Object.keys(result)).toHaveLength(0);
    });
});
