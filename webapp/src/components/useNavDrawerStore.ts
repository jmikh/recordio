import { create } from 'zustand';

/**
 * Open state of the pulled-out main nav (NavDrawer). A store rather than page
 * state because the editor's global key handler has to know the drawer is up —
 * Space must not start playback behind the dimmed backdrop.
 */
interface NavDrawerState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

export const useNavDrawerStore = create<NavDrawerState>(set => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));
