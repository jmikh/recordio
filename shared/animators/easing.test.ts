import { describe, it, expect } from 'vitest';
import { applyEasing } from './easing';

describe('applyEasing', () => {
    const styles = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;

    for (const style of styles) {
        describe(style, () => {
            it('t=0 returns 0', () => expect(applyEasing(0, style)).toBe(0));
            it('t=1 returns 1', () => expect(applyEasing(1, style)).toBe(1));

            it('clamps below 0', () => expect(applyEasing(-0.5, style)).toBe(0));
            it('clamps above 1', () => expect(applyEasing(1.5, style)).toBe(1));

            it('monotonically increasing', () => {
                let prev = 0;
                for (let t = 0.1; t <= 1.0; t += 0.1) {
                    const val = applyEasing(t, style);
                    expect(val).toBeGreaterThanOrEqual(prev);
                    prev = val;
                }
            });

            it('output bounded [0, 1]', () => {
                for (let t = 0; t <= 1.0; t += 0.05) {
                    const val = applyEasing(t, style);
                    expect(val).toBeGreaterThanOrEqual(0);
                    expect(val).toBeLessThanOrEqual(1);
                }
            });
        });
    }

    describe('linear', () => {
        it('t=0.5 returns 0.5', () => expect(applyEasing(0.5, 'linear')).toBe(0.5));
        it('t=0.25 returns 0.25', () => expect(applyEasing(0.25, 'linear')).toBe(0.25));
    });

    describe('ease-in', () => {
        it('slower start: t=0.5 < 0.5', () => expect(applyEasing(0.5, 'ease-in')).toBeLessThan(0.5));
    });

    describe('ease-out', () => {
        it('faster start: t=0.5 > 0.5', () => expect(applyEasing(0.5, 'ease-out')).toBeGreaterThan(0.5));
    });

    describe('ease-in-out', () => {
        it('t=0.5 returns 0.5 (symmetry)', () => expect(applyEasing(0.5, 'ease-in-out')).toBe(0.5));
        it('first half slower: t=0.25 < 0.25', () => expect(applyEasing(0.25, 'ease-in-out')).toBeLessThan(0.25));
        it('second half faster: t=0.75 > 0.75', () => expect(applyEasing(0.75, 'ease-in-out')).toBeGreaterThan(0.75));
    });
});
