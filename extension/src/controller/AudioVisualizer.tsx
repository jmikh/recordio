import { useEffect, useRef, useState } from 'react';
import { BiMicrophone } from 'react-icons/bi';

interface AudioVisualizerProps {
    stream: MediaStream | null;
}

/**
 * Circular audio visualizer with a mic icon in the center.
 * The ring fills from the bottom with primary → secondary gradient
 * based on current volume level. When silent, ring is a muted gray.
 */
export function AudioVisualizer({ stream }: AudioVisualizerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const animationRef = useRef<number | null>(null);
    const [volume, setVolume] = useState(0);

    useEffect(() => {
        if (!stream || stream.getAudioTracks().length === 0) {
            setVolume(0);
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
            return;
        }

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        if (ctx.state === 'suspended') {
            ctx.resume();
        }

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        sourceRef.current = source;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        let smoothedPercent = 0;

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);

            analyser.getByteTimeDomainData(dataArray);
            let sumSquares = 0.0;
            for (let i = 0; i < bufferLength; i++) {
                const norm = (dataArray[i] / 128.0) - 1.0;
                sumSquares += norm * norm;
            }
            const rms = Math.sqrt(sumSquares / bufferLength);

            let targetPercent = rms * 4;
            if (targetPercent > 1) targetPercent = 1;

            smoothedPercent = smoothedPercent + (targetPercent - smoothedPercent) * 0.2;
            setVolume(smoothedPercent);
        };

        draw();

        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
            if (sourceRef.current) sourceRef.current.disconnect();
            if (analyserRef.current) analyserRef.current.disconnect();
            if (ctx.state !== 'closed') ctx.close().catch(() => { });
        };
    }, [stream]);

    // Use a conic gradient via CSS to fill the ring based on volume
    const fillAngle = volume * 360;

    return (
        <div className="relative flex items-center justify-center" style={{ width: 120, height: 120 }}>
            {/* Ring background (empty state) */}
            <div
                className="absolute inset-0 rounded-full"
                style={{
                    background: `conic-gradient(
                        from 180deg,
                        var(--primary) 0deg,
                        var(--secondary) ${fillAngle}deg,
                        var(--border-default) ${fillAngle}deg,
                        var(--border-default) 360deg
                    )`,
                    transition: 'none',
                }}
            />
            {/* Inner circle to create the ring effect */}
            <div
                className="absolute rounded-full bg-surface-raised"
                style={{
                    inset: 5,
                }}
            />
            {/* Mic icon in center */}
            <BiMicrophone size={28} className="relative z-10 text-text-main" />
        </div>
    );
}
