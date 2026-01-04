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
        analyser.fftSize = 512; // higher number more bins

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!stream.active) return;

            animationRef.current = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            const width = canvas.width;
            const height = canvas.height;
            ctx.clearRect(0, 0, width, height);

            const barWidth = (width / bufferLength) * 2.5;
            let barHeight;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                barHeight = (dataArray[i] / 255) * height; // Normalize to canvas height

                // Draw rounded bar
                ctx.fillStyle = '#A855F7'; // Purple-500

                // Simple rect for now, could be improved
                ctx.fillRect(x, height - barHeight, barWidth, barHeight);

                x += barWidth + 2;
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
        <div className="w-full h-12 flex items-center justify-center bg-slate-900/50 rounded-lg overflow-hidden border border-slate-700/50 mt-2">
            <canvas
                ref={canvasRef}
                width={200}
                height={30}
                className="w-full h-full"
            />
        </div>
    );
};
