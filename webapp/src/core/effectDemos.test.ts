import { describe, it, expect } from 'vitest';
import { createDefaultSettings } from './Project';
import { buildDefaultsTemplateProject } from './defaultsTemplate';
import { buildEffectDemo, demoZoomViewport, type DemoKind } from './effectDemos';
import { SAMPLE_CARD_RECT, SAMPLE_CLICK_POINT } from './sampleMedia';

const KINDS: DemoKind[] = ['click', 'keyboard', 'zoom', 'shrink', 'spotlight'];

function template(overrides: (s: ReturnType<typeof createDefaultSettings>) => void = () => {}) {
    const settings = createDefaultSettings();
    overrides(settings);
    return buildDefaultsTemplateProject(settings);
}

describe('buildEffectDemo', () => {
    it('every kind yields a positive duration and the requested kind', () => {
        const project = template();
        for (const kind of KINDS) {
            const clip = buildEffectDemo(kind, project);
            expect(clip.kind).toBe(kind);
            expect(clip.durationMs).toBeGreaterThan(0);
        }
    });

    it('click: one click on the sample card, outlives the painter animation', () => {
        const clip = buildEffectDemo('click', template());
        expect(clip.userEvents.mouseClicks).toHaveLength(1);
        expect(clip.userEvents.mouseClicks[0].mousePos).toEqual(SAMPLE_CLICK_POINT);
        expect(clip.userEvents.keyboardEvents).toHaveLength(0);
        expect(clip.zoomSegments).toHaveLength(0);
        // click at 100 ms + 500 ms paint window must fit inside the clip
        expect(clip.durationMs).toBeGreaterThan(100 + 500);
    });

    it('keyboard: one ⌘K keystroke, outlives the painter display window', () => {
        const clip = buildEffectDemo('keyboard', template());
        expect(clip.userEvents.keyboardEvents).toHaveLength(1);
        expect(clip.userEvents.keyboardEvents[0]).toMatchObject({ key: 'k', metaKey: true, ctrlKey: false });
        expect(clip.userEvents.mouseClicks).toHaveLength(0);
        expect(clip.durationMs).toBeGreaterThan(100 + 1500);
    });

    it('zoom: a visible segment stamped with output times, using the current transition/easing', () => {
        const project = template(s => {
            s.zoom.transitionDurationMs = 400;
            s.zoom.easing = 'linear';
            s.zoom.maxZoom = 2;
        });
        const clip = buildEffectDemo('zoom', project);
        expect(clip.zoomSegments).toHaveLength(1);
        const [seg] = clip.zoomSegments;
        expect(seg.visible).toBe(true);
        expect(seg.outputStartTimeMs).toBe(seg.sourceStartTimeMs);
        expect(seg.transitionDurationMs).toBe(400);
        expect(seg.easing).toBe('linear');
        expect(seg.type).toBe('auto');
        // viewport = outputSize / maxZoom
        expect(seg.rectPx.width).toBeCloseTo(1920 / 2);
        expect(seg.rectPx.height).toBeCloseTo(1080 / 2);
        // in (T) → hold → out (T), then the clip ends
        expect(clip.durationMs).toBeGreaterThan(seg.sourceEndTimeMs + 400);
        // the triggering click is shown as a cue
        expect(clip.userEvents.mouseClicks).toHaveLength(1);
    });

    it('zoom viewport stays inside the frame for a click near the edge', () => {
        // the sample card sits top-left; at high zoom the centred viewport must be clamped
        const project = template(s => { s.zoom.maxZoom = 4; });
        const rect = demoZoomViewport(project);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(1920 + 1e-6);
        expect(rect.y + rect.height).toBeLessThanOrEqual(1080 + 1e-6);
        expect(rect.width).toBeCloseTo(1920 / 4);
    });

    it('shrink: plays the same zoom clip (the camera animator shrinks the bubble while zoomed)', () => {
        const project = template(s => { s.zoom.transitionDurationMs = 500; });
        const shrink = buildEffectDemo('shrink', project);
        const zoom = buildEffectDemo('zoom', project);
        expect(shrink.kind).toBe('shrink');
        expect(shrink.zoomSegments).toHaveLength(1);
        expect(shrink.durationMs).toBe(zoom.durationMs);
        expect(shrink.zoomSegments[0].rectPx).toEqual(zoom.zoomSegments[0].rectPx);
    });

    it('spotlight: a visible segment over the sample card carrying the current dim / scale / transition / easing', () => {
        const project = template(s => {
            s.spotlight.dimOpacity = 0.7;
            s.spotlight.enlargeScale = 1.5;
            s.spotlight.transitionDurationMs = 300;
            s.spotlight.easing = 'ease-out';
        });
        const clip = buildEffectDemo('spotlight', project);
        expect(clip.spotlightSegments).toHaveLength(1);
        const [seg] = clip.spotlightSegments;
        expect(seg.visible).toBe(true);
        expect(seg).toMatchObject({ dimOpacity: 0.7, scale: 1.5, transitionDurationMs: 300, easing: 'ease-out' });
        expect(seg.sourceRect).toEqual(SAMPLE_CARD_RECT);
        expect(clip.durationMs).toBeGreaterThan(seg.sourceEndTimeMs);
        expect(clip.zoomSegments).toHaveLength(0);
    });
});
