import React, { useEffect, useRef } from 'react';

interface AudioVisualizerWrapperProps {
    stream: MediaStream | null;
}

export const AudioVisualizerWrapper: React.FC<AudioVisualizerWrapperProps> = ({ stream }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (!stream || !stream.active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set up Audio Context
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);

        source.connect(analyser);
        analyser.fftSize = 256;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        // Cache colors outside the draw loop
        const styles = getComputedStyle(document.documentElement);
        const activeColor = styles.getPropertyValue('--primary').trim() || 'oklch(0.58 0.19 265)';
        const inactiveColor = styles.getPropertyValue('--color-surface-raised').trim() || 'oklch(0.21 0.014 270)';

        const totalSegments = 16;
        const gap = 2;
        let smoothedLevel = 0;

        // Sensitivity tuning
        const noiseGate = 0.04;  // Below this RMS, treat as silence
        const boost = 2.5;       // Amplify so it reaches full at loud speech

        const draw = () => {
            if (!stream.active) return;

            animationRef.current = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            // Compute RMS level across all frequency bins
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                const normalized = dataArray[i] / 255;
                sum += normalized * normalized;
            }
            let rms = Math.sqrt(sum / bufferLength);

            // Apply noise gate and boost
            rms = rms < noiseGate ? 0 : Math.min(1, (rms - noiseGate) * boost);

            // Smooth the level for less jittery animation
            smoothedLevel += (rms - smoothedLevel) * 0.3;

            const width = canvas.width;
            const height = canvas.height;
            ctx.clearRect(0, 0, width, height);

            const segmentWidth = (width - gap * (totalSegments - 1)) / totalSegments;
            const radius = 2;
            const litCount = Math.round(smoothedLevel * totalSegments);

            for (let i = 0; i < totalSegments; i++) {
                const x = i * (segmentWidth + gap);

                if (i < litCount) {
                    // Active segment: filled
                    ctx.fillStyle = activeColor;
                    ctx.beginPath();
                    ctx.roundRect(x, 0, segmentWidth, height, radius);
                    ctx.fill();
                } else {
                    // Inactive segment: filled with surface-raised
                    ctx.fillStyle = inactiveColor;
                    ctx.beginPath();
                    ctx.roundRect(x, 0, segmentWidth, height, radius);
                    ctx.fill();
                }
            }
        };

        draw();

        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
            audioContext.close();
        };
    }, [stream]);

    if (!stream) return null;

    return (
        <div className="w-full mt-2">
            <canvas
                ref={canvasRef}
                width={300}
                height={16}
                className="w-full h-4"
            />
        </div>
    );
};
