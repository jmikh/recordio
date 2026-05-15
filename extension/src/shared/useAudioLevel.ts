/**
 * @fileoverview Shared audio level meter hook
 *
 * Analyses a MediaStream's audio in real-time and returns a 0–1 smoothed RMS
 * level suitable for driving a level bar. Used by MicrophoneCard (controller)
 * and PreRecordingView (popup).
 */

import { useState, useEffect, useRef } from 'react';

export function useAudioLevel(stream: MediaStream | null): number {
    const [level, setLevel] = useState(0);
    const rafRef = useRef<number>(0);

    useEffect(() => {
        if (!stream) { setLevel(0); return; }

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx() as AudioContext;
        if (ctx.state === 'suspended') ctx.resume();

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const bufLen = analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        let smoothed = 0;

        const tick = () => {
            rafRef.current = requestAnimationFrame(tick);
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < bufLen; i++) {
                const n = (data[i] / 128) - 1;
                sum += n * n;
            }
            const rms = Math.sqrt(sum / bufLen);
            const target = Math.min(rms * 4, 1);
            smoothed += (target - smoothed) * 0.25;
            setLevel(smoothed);
        };
        tick();

        return () => {
            cancelAnimationFrame(rafRef.current);
            source.disconnect();
            analyser.disconnect();
            if (ctx.state !== 'closed') ctx.close().catch(() => { });
            setLevel(0);
        };
    }, [stream]);

    return level;
}
