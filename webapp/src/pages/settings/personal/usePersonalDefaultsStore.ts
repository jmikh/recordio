import { create } from 'zustand';

/**
 * Cross-tree state for the Personal Settings page
 * (plans/user-default-project-settings §3.6): the dashboard sidebar sits
 * outside the page, but its navigation must know whether the defaults
 * editor has unsaved changes so it can ask before leaving.
 */
interface PersonalDefaultsState {
    /** The defaults template differs from what is saved (or from the factory when nothing is saved). */
    isDirty: boolean;
    setDirty: (dirty: boolean) => void;
}

export const usePersonalDefaultsStore = create<PersonalDefaultsState>()((set) => ({
    isDirty: false,
    setDirty: (isDirty) => set({ isDirty }),
}));
