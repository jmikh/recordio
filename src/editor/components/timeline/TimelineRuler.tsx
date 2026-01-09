import React, { useRef, useEffect } from 'react';
import { formatTimeCode } from '../../utils';

interface TimelineRulerProps {
    totalWidth: number;
    pixelsPerSec: number;
    height?: number;
    headerWidth?: number;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ totalWidth, pixelsPerSec, height = 24, headerWidth = 0 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        // Don't use window.innerWidth directly without offset, and remove buffer
        const width = Math.max(totalWidth, window.innerWidth - headerWidth);

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        // Read theme colors
        const style = getComputedStyle(document.documentElement);
        const textColor = style.getPropertyValue('--color-text-muted') || '#64748b';
        const tickColor = style.getPropertyValue('--color-border-primary') || '#334155';

        ctx.fillStyle = textColor; // text-muted
        ctx.strokeStyle = tickColor; // border-primary (or highlight)
        ctx.font = `10px ${style.getPropertyValue('--font-sans') || 'sans-serif'}`;
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

        const durationMs = (totalWidth / pixelsPerSec) * 1000;

        ctx.beginPath();
        // Start t at 0, draw at x + paddingLeft
        for (let t = 0; t <= durationMs; t += minorInterval) {
            const x = ((t / 1000) * pixelsPerSec);

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

    }, [totalWidth, pixelsPerSec, height]);

    return (
        <div className="sticky top-0 z-30 bg-surface border-b border-border">
            <canvas ref={canvasRef} className="block pointer-events-none" style={{ height: `${height}px` }} />
        </div>
    );
};
