import { create } from 'zustand';
import type { TimeMs } from '../../core/types';

interface PlaybackState {
    isPlaying: boolean;
    currentTimeMs: TimeMs;
    previewTimeMs: TimeMs | null;

    setIsPlaying: (playing: boolean) => void;
    setCurrentTime: (timeMs: TimeMs) => void;
    setPreviewTime: (timeMs: TimeMs | null) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
    isPlaying: false,
    currentTimeMs: 0,
    previewTimeMs: null,

    setIsPlaying: (isPlaying) => set({ isPlaying }),
    setCurrentTime: (currentTimeMs) => set({ currentTimeMs }),
    setPreviewTime: (previewTimeMs) => set({ previewTimeMs }),
}));
