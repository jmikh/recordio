import React, { useRef, useEffect } from 'react';
import { formatTimeCode } from '../../utils';
import { useThemeStore } from '../../../theme/useThemeStore';

interface TimelineRulerProps {
    totalWidth: number;
    pixelsPerSec: number;
    height?: number;
    headerWidth?: number;
    scrollLeft?: number;
    containerWidth?: number;
}

// Tick spacing per zoom level, checked top-down (first match wins)
const RULER_TIERS = [
    { minPps: 50, major: 1000, minor: 100 },
    { minPps: 20, major: 2000, minor: 500 },
    { minPps: 10, major: 5000, minor: 1000 },
    { minPps: 5, major: 10000, minor: 2000 },
    { minPps: 2, major: 30000, minor: 5000 },
    { minPps: 0, major: 60000, minor: 10000 },
];

export const TimelineRuler: React.FC<TimelineRulerProps> = ({
    totalWidth,
    pixelsPerSec,
    height = 24,
    headerWidth = 0,
    scrollLeft = 0,
    containerWidth = 0,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Subscribe to theme changes to force redraw
    const theme = useThemeStore((s) => s.theme);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let cancelled = false;

        // Same token the ruler draws with, read once for the preload spec below.
        const themeFontFamily = (getComputedStyle(document.documentElement)
            .getPropertyValue('--font-sans') || 'sans-serif').replace(/['"]/g, '');

        const draw = () => {
            if (cancelled) return;

            const dpr = window.devicePixelRatio || 1;

            // containerWidth is the scroll container's clientWidth, which already
            // excludes the header column. Only subtract headerWidth from the
            // window-width fallback used before the ResizeObserver has measured.
            const viewportWidth = containerWidth || (window.innerWidth - headerWidth);

            // Full logical width of the ruler: at least the visible viewport so
            // ticks run to the right edge even when the project fits on screen.
            const fullWidth = Math.max(totalWidth, viewportWidth);

            // Viewport-aware: only render the visible portion + buffer
            const BUFFER = 200; // extra px each side for smooth scroll
            const viewStart = Math.max(0, scrollLeft - BUFFER);
            const viewEnd = Math.min(fullWidth, scrollLeft + viewportWidth + BUFFER);
            const viewWidth = viewEnd - viewStart;

            canvas.width = viewWidth * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${viewWidth}px`;
            canvas.style.height = `${height}px`;
            // Position the canvas so it covers the visible area
            canvas.style.transform = `translateX(${viewStart}px)`;

            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, viewWidth, height);

            // Read theme colors from semantic tokens
            const style = getComputedStyle(document.documentElement);
            const textColor = style.getPropertyValue('--text-disabled').trim();
            const tickColor = style.getPropertyValue('--text-disabled').trim();

            // Strip quotes from CSS variable so canvas font string is well-formed
            const fontFamily = (style.getPropertyValue('--font-sans') || 'sans-serif').replace(/['"]/g, '');

            ctx.fillStyle = textColor;
            ctx.strokeStyle = tickColor;
            ctx.font = `500 10px ${fontFamily}`;
            ctx.textBaseline = 'top';

            // Coarser intervals as we zoom out, keeping labeled ticks ~50px+ apart
            const tier = RULER_TIERS.find(t => pixelsPerSec >= t.minPps) ?? RULER_TIERS[RULER_TIERS.length - 1];
            const majorInterval = tier.major;
            const minorInterval = tier.minor;

            // Calculate visible time range
            const visibleDurationMs = (fullWidth / pixelsPerSec) * 1000;

            // Align first tick to a minor-interval boundary at or before the view start
            const startTimeMs = Math.floor((viewStart / pixelsPerSec) * 1000 / minorInterval) * minorInterval;

            ctx.beginPath();
            for (let t = startTimeMs; t <= visibleDurationMs; t += minorInterval) {
                const xAbsolute = (t / 1000) * pixelsPerSec;
                // Stop once past the visible area
                if (xAbsolute > viewEnd) break;
                // Position relative to our viewport canvas
                const x = xAbsolute - viewStart;

                if (t % majorInterval === 0) {
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, height);
                    const label = formatTimeCode(t, false);
                    ctx.fillText(label, x + 4, 2);
                    // 700 is too heavy here, so a hairline stroke fakes the
                    // in-between weight. (Now that the UI font is loaded as a
                    // variable face, this could become a real intermediate weight.)
                    ctx.save();
                    ctx.strokeStyle = textColor;
                    ctx.lineWidth = 0.35;
                    ctx.lineJoin = 'round';
                    ctx.strokeText(label, x + 4, 2);
                    ctx.restore();
                } else {
                    ctx.moveTo(x, height - 6);
                    ctx.lineTo(x, height);
                }
            }
            ctx.stroke();
        };

        // Draw with fallback immediately so the ruler isn't blank
        draw();

        // Actively trigger + wait for the UI font binary to download.
        // document.fonts.load() returns a promise that resolves only once the
        // font data is actually usable (unlike .check() which only tests if
        // an @font-face rule is registered).
        const fontSpec = `500 10px ${themeFontFamily}`;
        document.fonts.load(fontSpec).then(() => {
            if (!cancelled) draw();
        });

        // Safety net: if the CSS @import hasn't been parsed yet when load()
        // was called, the promise resolves immediately with nothing. Listen
        // for any future font-load events and redraw when the font arrives.
        const onFontLoad = () => {
            if (!cancelled && document.fonts.check(fontSpec)) {
                draw();
                document.fonts.removeEventListener('loadingdone', onFontLoad);
            }
        };
        document.fonts.addEventListener('loadingdone', onFontLoad);

        return () => {
            cancelled = true;
            document.fonts.removeEventListener('loadingdone', onFontLoad);
        };
    }, [totalWidth, pixelsPerSec, height, scrollLeft, containerWidth, headerWidth, theme]);

    return (
        <div id="timeline-ruler" className="sticky top-0 z-[var(--z-index-overlay)] bg-surface border-b border-border">
            <canvas ref={canvasRef} className="block pointer-events-none" style={{ height: `${height}px` }} />
        </div>
    );
};
