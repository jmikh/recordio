/**
 * Positional writes for the rendered MP4.
 *
 * The render page streams muxed output in chunks tagged with their byte offset
 * (mp4-muxer StreamTarget). Most chunks are sequential, but finalize() patches
 * header bytes near the start of the file, so each chunk is written at its own
 * offset rather than appended.
 */

import * as fs from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Write `source` into `filePath` starting at byte `position`, creating the file if needed. */
export async function writeAtPosition(filePath: string, position: number, source: Readable): Promise<void> {
    const flags = fs.existsSync(filePath) ? 'r+' : 'w';
    await pipeline(source, fs.createWriteStream(filePath, { flags, start: position }));
}
