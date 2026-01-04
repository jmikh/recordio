import { useState, useEffect } from 'react';

interface AudioAnalysisResult {
    peaks: number[]; // Normalized -1..1 or 0..1 depending on usage
    duration: number;
    isLoading: boolean;
    error: string | null;
}

const PEAKS_SAMPLES_PER_SEC = 100; // Resolution of the waveform
const CACHE = new Map<string, AudioAnalysisResult>();

export function useAudioAnalysis(sourceId: string, url: string): AudioAnalysisResult {
    const [result, setResult] = useState<AudioAnalysisResult>(() => {
        if (CACHE.has(sourceId)) {
            return CACHE.get(sourceId)!;
        }
        return { peaks: [], duration: 0, isLoading: true, error: null };
    });

    useEffect(() => {
        if (!sourceId || !url) return;
        if (CACHE.has(sourceId)) {
            setResult(CACHE.get(sourceId)!);
            return;
        }

        let active = true;

        const loadAudio = async () => {
            // If already cached by another component mounting simultaneously
            if (CACHE.has(sourceId)) {
                if (active) setResult(CACHE.get(sourceId)!);
                return;
            }

            try {
                setResult(prev => ({ ...prev, isLoading: true, error: null }));

                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to fetch audio: ${response.statusText}`);

                const arrayBuffer = await response.arrayBuffer();
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                const duration = audioBuffer.duration;
                const channelData = audioBuffer.getChannelData(0); // Use first channel (mono)

                // Downsample
                const totalSamples = channelData.length;
                const totalPixels = Math.ceil(duration * PEAKS_SAMPLES_PER_SEC);
                const sampleSize = Math.floor(totalSamples / totalPixels);
                const peaks: number[] = [];

                for (let i = 0; i < totalPixels; i++) {
                    const start = i * sampleSize;
                    let min = 1.0;
                    let max = -1.0;

                    // Find min/max in this chunk
                    for (let j = 0; j < sampleSize && start + j < totalSamples; j++) {
                        const val = channelData[start + j];
                        if (val < min) min = val;
                        if (val > max) max = val;
                    }

                    // We'll store just the max amplitude for simplicity (0..1)
                    // Or we could store min/max for fuller wave.
                    // Let's store max absolute value for a symmetric wave
                    const peak = Math.max(Math.abs(min), Math.abs(max));
                    peaks.push(peak);
                }

                const finalResult = { peaks, duration, isLoading: false, error: null };
                CACHE.set(sourceId, finalResult);

                if (active) {
                    setResult(finalResult);
                }

                // Cleanup context
                audioContext.close();

            } catch (err: any) {
                console.error("Audio analysis failed", err);
                const errorResult = { peaks: [], duration: 0, isLoading: false, error: err.message };
                // Don't cache errors? Or maybe do to prevent retry loops.
                if (active) setResult(errorResult);
            }
        };

        loadAudio();

        return () => {
            active = false;
        };

    }, [sourceId, url]);

    return result;
}
