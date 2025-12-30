import React, { useRef, useEffect } from 'react';
import { formatTimeCode } from '../utils';

interface TimelineRulerProps {
    totalWidth: number;
    pixelsPerSec: number;
    height?: number;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ totalWidth, pixelsPerSec, height = 24 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(totalWidth + 500, window.innerWidth);

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#64748b';
        ctx.strokeStyle = '#334155';
        ctx.font = '10px monospace';
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

        const durationMs = (width / pixelsPerSec) * 1000;

        ctx.beginPath();
        for (let t = 0; t <= durationMs; t += minorInterval) {
            const x = (t / 1000) * pixelsPerSec;
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
        <div className="sticky top-0 z-10 bg-[#1e1e1e] border-b border-[#333]">
            <canvas ref={canvasRef} className="block pointer-events-none" style={{ height: `${height}px` }} />
        </div>
    );
};
