/**
 * services/sharePreviewImage — the real renderer (sharp + the bundled
 * font), no fakes: what's under test is the pixels' shape, and that the
 * bundled font actually loads.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
    PREVIEW_HEIGHT,
    PREVIEW_WIDTH,
    renderGenericPreviewCard,
    renderVideoPreviewCard,
} from '../src/services/sharePreviewImage.js';

function thumbnail(width: number, height: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: '#336699' } }).webp().toBuffer();
}

async function sizeOf(png: Buffer) {
    const meta = await sharp(png).metadata();
    return { format: meta.format, width: meta.width, height: meta.height };
}

const CARD = { format: 'png', width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };

describe('renderVideoPreviewCard', () => {
    it.each([
        ['16:9 at the new capture size', 1200, 675],
        ['the legacy 480px capture (upscaled)', 480, 270],
        ['a portrait output (letterboxed)', 675, 1200],
        ['a square output (letterboxed)', 800, 800],
    ])('is a 1200×675 PNG for %s', async (_label, width, height) => {
        const card = await renderVideoPreviewCard({ thumbnail: await thumbnail(width, height), durationMs: 222_900 });
        expect(await sizeOf(card)).toEqual(CARD);
    });

    it('draws the duration pill only when the duration is known', async () => {
        const thumb = await thumbnail(1200, 675);
        const [withPill, withoutPill] = await Promise.all([
            renderVideoPreviewCard({ thumbnail: thumb, durationMs: 222_900 }),
            renderVideoPreviewCard({ thumbnail: thumb }),
        ]);
        expect(withPill.equals(withoutPill)).toBe(false);
        expect(await sizeOf(withoutPill)).toEqual(CARD);
    });

    it('rejects a thumbnail that is not an image', async () => {
        await expect(renderVideoPreviewCard({ thumbnail: new Uint8Array([1, 2, 3]) })).rejects.toThrow();
    });
});

describe('renderGenericPreviewCard', () => {
    it('is a 1200×675 PNG, rendered once and reused', async () => {
        const first = await renderGenericPreviewCard();
        expect(await sizeOf(first)).toEqual(CARD);
        expect(await renderGenericPreviewCard()).toBe(first);
    });
});
