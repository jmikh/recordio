import { describe, expect, it } from 'vitest';
import { resolveExportQuality } from './exportQuality';

const OUTPUT_16_9 = { width: 1920, height: 1080 };

describe('resolveExportQuality', () => {
    it('HD always renders 1080p, whatever the recording size', () => {
        expect(resolveExportQuality('HD', { width: 3840, height: 2160 }, OUTPUT_16_9)).toBe('1080p');
        expect(resolveExportQuality('HD', { width: 1280, height: 720 }, OUTPUT_16_9)).toBe('1080p');
    });

    it.each([
        // [recording, expected] — 4K picks the smallest tier at or above the recording
        [{ width: 1700, height: 960 }, '1080p'],
        [{ width: 1920, height: 992 }, '1080p'],
        [{ width: 1800, height: 1020 }, '1080p'],
        [{ width: 2364, height: 1330 }, '2K'],
        [{ width: 2560, height: 1440 }, '2K'],
        [{ width: 2666, height: 1500 }, '4K'],
        [{ width: 3456, height: 2234 }, '4K'],
    ] as const)('4K for a %o recording renders %s', (recording, expected) => {
        expect(resolveExportQuality('4K', recording, OUTPUT_16_9)).toBe(expected);
    });

    it('a recording wider than the output is sized by its width', () => {
        // 3440×1329 ultrawide: only 1329 rows tall, but its width needs ~1935 rows of 16:9
        expect(resolveExportQuality('4K', { width: 3440, height: 1329 }, OUTPUT_16_9)).toBe('4K');
        // 2400×1000: 1000 tall, but 2400 wide needs 1350 rows → 1440p
        expect(resolveExportQuality('4K', { width: 2400, height: 1000 }, OUTPUT_16_9)).toBe('2K');
    });
});
