import { create } from 'zustand';

export interface SyncState {
    status: 'idle' | 'syncing' | 'error' | 'offline';
    lastSyncedAt: Date | null;
    pendingMediaUploads: number;
    currentUpload: { projectId: string; type: string; progress: number } | null;
    currentDownload: { projectId: string; type: string; progress: number } | null;
    error: string | null;
    /** Set when another device wrote a newer version */
    conflict: { projectId: string } | null;
    /** Path to navigate to after conflict resolution (set when leaving editor mid-conflict) */
    pendingNavigation: string | null;
}

interface SyncStatusStore extends SyncState {
    setSyncing: () => void;
    setIdle: () => void;
    setError: (error: string) => void;
    setOffline: () => void;
    setLastSyncedAt: (date: Date) => void;
    setPendingMediaUploads: (count: number) => void;
    setCurrentUpload: (upload: SyncState['currentUpload']) => void;
    setCurrentDownload: (download: SyncState['currentDownload']) => void;
    setConflict: (conflict: SyncState['conflict']) => void;
    clearConflict: () => void;
    setPendingNavigation: (path: string | null) => void;
}

export const useSyncStatusStore = create<SyncStatusStore>()((set) => ({
    status: 'idle',
    lastSyncedAt: null,
    pendingMediaUploads: 0,
    currentUpload: null,
    currentDownload: null,
    error: null,
    conflict: null,
    pendingNavigation: null,

    setSyncing: () => set({ status: 'syncing', error: null }),
    setIdle: () => set({ status: 'idle', error: null }),
    setError: (error) => set({ status: 'error', error }),
    setOffline: () => set({ status: 'offline' }),
    setLastSyncedAt: (date) => set({ lastSyncedAt: date }),
    setPendingMediaUploads: (count) => set({ pendingMediaUploads: count }),
    setCurrentUpload: (upload) => set({ currentUpload: upload }),
    setCurrentDownload: (download) => set({ currentDownload: download }),
    setConflict: (conflict) => set({ conflict }),
    clearConflict: () => set({ conflict: null, pendingNavigation: null }),
    setPendingNavigation: (path) => set({ pendingNavigation: path }),
}));
