import React, { useMemo, useRef, useEffect } from 'react';
import { AUDIO_PEAKS_SAMPLES_PER_SEC } from '../../../../core/audioConstants';

interface StaticAudioWaveProps {
    peaks: number[]; // Full cached peaks for the source
    sourceStartMs: number; // Where this segment starts in source time
    sourceEndMs: number;   // Where this segment ends in source time
    width: number; // Render width in px
    height: number;
}

const WAVEFORM_COLOR = 'rgba(255, 255, 255, 1)';

const StaticAudioWaveComponent: React.FC<StaticAudioWaveProps> = ({
    peaks,
    sourceStartMs,
    sourceEndMs,
    width,
    height,
}) => {
    //console.log("StaticAudioWave", peaks.length, sourceStartMs, sourceEndMs, width, height, color);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Calculate which slice of peaks to show
    // peaks array is 25 per sec.
    // Index = (ms / 1000) * AUDIO_PEAKS_SAMPLES_PER_SEC
    const startIndex = Math.floor((sourceStartMs / 1000) * AUDIO_PEAKS_SAMPLES_PER_SEC);
    const endIndex = Math.ceil((sourceEndMs / 1000) * AUDIO_PEAKS_SAMPLES_PER_SEC);

    const visiblePeaks = useMemo(() => {
        // Clamp
        const start = Math.max(0, startIndex);
        const end = Math.min(peaks.length, endIndex);
        return peaks.slice(start, end);
    }, [peaks, startIndex, endIndex]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear
        ctx.clearRect(0, 0, width, height);

        if (visiblePeaks.length === 0) return;

        // Drawing params
        ctx.fillStyle = WAVEFORM_COLOR;
        const barWidth = width / visiblePeaks.length;

        const scaleY = height * 0.96; // Max height with 4% padding

        visiblePeaks.forEach((peak, i) => {
            const x = i * barWidth;
            const barHeight = peak * scaleY;

            // Draw from bottom
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);
        });

    }, [visiblePeaks, width, height]);



    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="pointer-events-none opacity-40"
            style={{ width, height }}
        />
    );
};

export const StaticAudioWave = React.memo(StaticAudioWaveComponent);
