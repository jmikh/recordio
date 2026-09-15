import { create } from 'zustand';
import type { AccessRole, SharePolicy } from '@shared/api';
import type { ScreenshotShareMeta } from '../screenshotService';

/**
 * Row metadata of the screenshot in play (editor + share modal +
 * dashboard card menu). Distinct from the document store: none of this
 * is part of screenshot_data or the undo/redo history. Sibling of
 * share/useProjectMetaStore.ts.
 */
interface ScreenshotMetaState {
    meta: ScreenshotShareMeta | null;
    setMeta: (meta: ScreenshotShareMeta) => void;
    setName: (name: string) => void;
    setShareSettings: (sharePolicy: SharePolicy, workspaceAccess: AccessRole) => void;
    setCloudVersion: (cloudVersion: number) => void;
    setRenderCloudVersion: (renderCloudVersion: number | null) => void;
    clear: () => void;
}

export const useScreenshotMetaStore = create<ScreenshotMetaState>((set) => ({
    meta: null,
    setMeta: (meta) => set({ meta }),
    setName: (name) => set((s) => (s.meta ? { meta: { ...s.meta, name } } : s)),
    setShareSettings: (sharePolicy, workspaceAccess) =>
        set((s) => (s.meta ? { meta: { ...s.meta, sharePolicy, workspaceAccess } } : s)),
    setCloudVersion: (cloudVersion) =>
        set((s) => (s.meta ? { meta: { ...s.meta, cloudVersion } } : s)),
    setRenderCloudVersion: (renderCloudVersion) =>
        set((s) => (s.meta ? { meta: { ...s.meta, renderCloudVersion } } : s)),
    clear: () => set({ meta: null }),
}));
