import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { writeAtPosition } from './resultFile';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-file-test-'));
    filePath = path.join(tmpDir, 'result.mp4');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const bytes = (...values: number[]) => Readable.from([Buffer.from(values)]);

describe('writeAtPosition', () => {
    it('assembles sequential chunks', async () => {
        await writeAtPosition(filePath, 0, bytes(1, 2, 3));
        await writeAtPosition(filePath, 3, bytes(4, 5));

        expect(fs.readFileSync(filePath)).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    });

    it('patches earlier bytes without truncating the file', async () => {
        // mp4-muxer finalize() rewrites the mdat size near the start after all data is written
        await writeAtPosition(filePath, 0, bytes(0, 0, 0, 0, 9, 9));
        await writeAtPosition(filePath, 1, bytes(7, 7));

        expect(fs.readFileSync(filePath)).toEqual(Buffer.from([0, 7, 7, 0, 9, 9]));
    });

    it('creates the file when the first chunk is not at offset 0', async () => {
        await writeAtPosition(filePath, 2, bytes(5));

        expect(fs.readFileSync(filePath)).toEqual(Buffer.from([0, 0, 5]));
    });
});
