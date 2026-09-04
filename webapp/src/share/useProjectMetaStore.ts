import { create } from 'zustand';
import type { AccessRole, ProjectEditor, SharePolicy } from '@shared/api';
import type { ProjectShareMeta } from '../storage/cloudProjectService';

/**
 * Share-relevant metadata of the project whose share settings are in
 * play (share-access model). Populated by the editor's project load OR
 * by the dashboard's card menu (project-get on demand); the ShareModal
 * reads it and optimistically updates it on share actions. Distinct
 * from useProjectStore: none of this is part of project_data or the
 * undo/redo history.
 */
interface ProjectMetaState {
    meta: ProjectShareMeta | null;
    setMeta: (meta: ProjectShareMeta) => void;
    setShareSettings: (sharePolicy: SharePolicy, workspaceAccess: AccessRole) => void;
    setEditors: (editors: ProjectEditor[]) => void;
    clear: () => void;
}

export const useProjectMetaStore = create<ProjectMetaState>((set) => ({
    meta: null,
    setMeta: (meta) => set({ meta }),
    setShareSettings: (sharePolicy, workspaceAccess) =>
        set((s) => (s.meta ? { meta: { ...s.meta, sharePolicy, workspaceAccess } } : s)),
    setEditors: (editors) =>
        set((s) => (s.meta ? { meta: { ...s.meta, editors } } : s)),
    clear: () => set({ meta: null }),
}));
