import { useEffect, useRef } from 'react';
import { useUIStore } from '../stores/useUIStore';
import { useProjectData } from '../stores/useProjectStore';
import { useMediaUrlStore } from '../../storage/useMediaUrlStore';

/**
 * Hook that manages background music playback in sync with the editor's
 * play/pause state. Creates an HTMLAudioElement that follows `isPlaying`
 * from UIStore — plays when timeline plays, pauses when timeline pauses.
 */
export const useBackgroundMusic = () => {
    const project = useProjectData();
    const isPlaying = useUIStore(s => s.isPlaying);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const prevTimeRef = useRef<number | null>(null);
    const isPlayingRef = useRef(isPlaying);
    isPlayingRef.current = isPlaying;

    const music = project?.settings?.audio?.music;
    const musicEnabled = music?.enabled ?? false;
    const musicVolume = music?.volume ?? 0.3;

    // Resolve the music URL based on source type
    const customBlobUrl = useMediaUrlStore(s => music?.storagePath ? s.urls[music.storagePath] : undefined);
    const musicUrl = musicEnabled
        ? (music?.source === 'preset' ? music?.presetUrl : customBlobUrl) ?? null
        : null;

    // Create/destroy audio element when URL changes
    useEffect(() => {
        // Cleanup old audio
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
            audioRef.current = null;
        }

        if (!musicUrl) return;

        const audio = new Audio(musicUrl);
        audio.loop = true;
        audio.volume = musicVolume;

        // When audio finishes loading, auto-play if timeline is already playing.
        // This handles the page-refresh case where the Audio element is created
        // after the user has already pressed play.
        audio.addEventListener('canplaythrough', () => {
            if (isPlayingRef.current && audio.paused) {
                const currentTimeSec = useUIStore.getState().currentTimeMs / 1000;
                if (audio.duration && isFinite(audio.duration)) {
                    audio.currentTime = currentTimeSec % audio.duration;
                }
                audio.play().catch(() => { });
            }
        }, { once: true });

        audioRef.current = audio;

        return () => {
            audio.pause();
            audio.src = '';
        };
    }, [musicUrl]);

    // Sync volume
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = musicVolume;
        }
    }, [musicVolume]);

    // Sync play/pause and position with the editor
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const currentTimeSec = useUIStore.getState().currentTimeMs / 1000;

        if (isPlaying) {
            // Seek music to match timeline position before playing
            if (audio.duration && isFinite(audio.duration)) {
                audio.currentTime = currentTimeSec % audio.duration;
            } else {
                audio.currentTime = currentTimeSec;
            }
            audio.play().catch(() => { });
        } else {
            audio.pause();
            // Keep position synced while paused
            if (audio.duration && isFinite(audio.duration)) {
                audio.currentTime = currentTimeSec % audio.duration;
            }
        }
    }, [isPlaying, musicUrl]);

    // Drift correction + fade-out during playback
    useEffect(() => {
        if (!isPlaying) {
            prevTimeRef.current = null;
            // Reset volume when paused
            if (audioRef.current) audioRef.current.volume = musicVolume;
            return;
        }

        const interval = setInterval(() => {
            const audio = audioRef.current;
            if (!audio || !audio.duration || !isFinite(audio.duration)) return;

            const currentMs = useUIStore.getState().currentTimeMs;
            const prev = prevTimeRef.current;
            prevTimeRef.current = currentMs;

            // Jump detection: re-sync on CTI seeks
            if (prev !== null) {
                const delta = Math.abs(currentMs - prev);
                if (delta > 500) {
                    audio.currentTime = (currentMs / 1000) % audio.duration;
                }
            }

            // Fade-out: ramp volume near the end of the output
            const fadeMs = music?.fadeOutDurationMs ?? 3000;
            if (fadeMs > 0) {
                const outputWindows = project?.timeline?.outputWindows;
                if (outputWindows?.length) {
                    // Compute total output duration from windows
                    let totalOutputMs = 0;
                    for (const w of outputWindows) {
                        totalOutputMs += (w.endMs - w.startMs) / (w.speed || 1);
                    }

                    const fadeStartMs = totalOutputMs - fadeMs;
                    if (currentMs >= fadeStartMs && fadeMs > 0) {
                        const fadeProgress = (currentMs - fadeStartMs) / fadeMs;
                        audio.volume = musicVolume * Math.max(0, 1 - fadeProgress);
                    } else {
                        audio.volume = musicVolume;
                    }
                }
            } else {
                audio.volume = musicVolume;
            }
        }, 100);

        return () => clearInterval(interval);
    }, [isPlaying, musicVolume, music?.fadeOutDurationMs]);
};
