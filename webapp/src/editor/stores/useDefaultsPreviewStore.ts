import { create } from 'zustand';
import type { DemoKind } from '../../core/effectDemos';

/**
 * The channel between the settings column's Preview buttons and the
 * preview canvas (plans/user-default-project-settings §3.8). A button
 * calls play(kind); the canvas picks up `requested` (the nonce makes
 * repeat plays of the same kind observable), reports `playing` while the
 * demo runs and clears it when done. stop() cancels a running demo.
 */
interface DefaultsPreviewState {
    requested: { kind: DemoKind; nonce: number } | null;
    playing: DemoKind | null;
    play: (kind: DemoKind) => void;
    stop: () => void;
    /** Renderer-side: mark a demo as started / finished. */
    setPlaying: (kind: DemoKind | null) => void;
}

let nonce = 0;

export const useDefaultsPreviewStore = create<DefaultsPreviewState>()((set) => ({
    requested: null,
    playing: null,
    play: (kind) => set({ requested: { kind, nonce: ++nonce } }),
    stop: () => set({ requested: null, playing: null }),
    setPlaying: (playing) => set({ playing }),
}));
