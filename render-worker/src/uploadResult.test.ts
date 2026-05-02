import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { uploadResult } from './uploadResult';

let tmpDir: string;
let testFile: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'));
    testFile = path.join(tmpDir, 'output.mp4');
    fs.writeFileSync(testFile, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])); // fake mp4
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('uploadResult', () => {
    it('uploads file via PUT with correct headers', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('ok', { status: 200 }),
        );

        await uploadResult(testFile, 'https://storage.example.com/upload');

        expect(fetchSpy).toHaveBeenCalledOnce();
        const [url, options] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://storage.example.com/upload');
        expect(options!.method).toBe('PUT');
        expect((options!.headers as any)['Content-Type']).toBe('video/mp4');
        expect((options!.headers as any)['x-upsert']).toBe('true');
    });

    it('calls onProgress with 0 and 1', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('ok', { status: 200 }),
        );

        const progress: number[] = [];
        await uploadResult(testFile, 'https://storage.example.com/upload', (f) => progress.push(f));

        expect(progress).toEqual([0, 1]);
    });

    it('retries on failure up to 3 times', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response('error', { status: 500 }))
            .mockResolvedValueOnce(new Response('error', { status: 500 }))
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));

        await uploadResult(testFile, 'https://storage.example.com/upload');

        expect(fetchSpy).toHaveBeenCalledTimes(3);
    }, 15000);

    it('throws after max retries exhausted', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
            new Response('server error', { status: 500 }),
        );

        await expect(
            uploadResult(testFile, 'https://storage.example.com/upload'),
        ).rejects.toThrow('Upload failed: 500');
    }, 15000);
});
