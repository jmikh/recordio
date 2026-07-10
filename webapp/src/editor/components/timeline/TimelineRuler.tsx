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

// ... (interface remains same)

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

        const draw = () => {
            if (cancelled) return;

            const dpr = window.devicePixelRatio || 1;

            // Full logical width of the ruler
            const fullWidth = Math.max(totalWidth, (containerWidth || window.innerWidth) - headerWidth);

            // Viewport-aware: only render the visible portion + buffer
            const BUFFER = 200; // extra px each side for smooth scroll
            const viewStart = Math.max(0, scrollLeft - BUFFER);
            const viewEnd = Math.min(fullWidth, scrollLeft + (containerWidth || window.innerWidth) + BUFFER);
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
            const textColor = style.getPropertyValue('--text-muted').trim();
            const tickColor = style.getPropertyValue('--text-disabled').trim();

            // Strip quotes from CSS variable so canvas font string is well-formed
            const fontFamily = (style.getPropertyValue('--font-sans') || 'sans-serif').replace(/['"]/g, '');

            ctx.fillStyle = textColor;
            ctx.strokeStyle = tickColor;
            ctx.font = `10px ${fontFamily}`;
            ctx.textBaseline = 'top';

            let majorInterval = 1000;
            let minorInterval = 100;

            if (pixelsPerSec < 20) {
                majorInterval = 5000;
                minorInterval = 1000;
            } else if (pixelsPerSec < 50) {
                majorInterval = 2000;
                minorInterval = 500;
            }

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
                    ctx.fillText(formatTimeCode(t), x + 4, 2);
                } else {
                    ctx.moveTo(x, height - 6);
                    ctx.lineTo(x, height);
                }
            }
            ctx.stroke();
        };

        // Draw with fallback immediately so the ruler isn't blank
        draw();

        // Actively trigger + wait for the Satoshi font binary to download.
        // document.fonts.load() returns a promise that resolves only once the
        // font data is actually usable (unlike .check() which only tests if
        // an @font-face rule is registered).
        const fontSpec = '10px Satoshi';
        document.fonts.load(fontSpec).then(() => {
            if (!cancelled) draw();
        });

        // Safety net: if the CSS @import hasn't been parsed yet when load()
        // was called, the promise resolves immediately with nothing. Listen
        // for any future font-load events and redraw when Satoshi arrives.
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
