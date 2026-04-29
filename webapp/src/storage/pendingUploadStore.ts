import { create } from 'zustand';

/**
 * Short-lived in-memory store to pass media blobs from ImportPage to the editor.
 * Blobs are set during import and consumed by useBackgroundUpload in the editor.
 * Cleared after upload completes or on navigation away.
 */

export interface UploadTarget {
    fileType: string;
    storagePath: string;
    signedUrl: string;
    token: string;
}

export interface PendingUpload {
    projectId: string;
    screenBlob: Blob;
    cameraBlob?: Blob;
    micBlob?: Blob;
    /** Signed upload URLs from project-create */
    uploads: UploadTarget[];
}

interface PendingUploadStore {
    pending: PendingUpload | null;
    setPending: (upload: PendingUpload) => void;
    clear: () => void;
}

export const usePendingUploadStore = create<PendingUploadStore>()((set) => ({
    pending: null,
    setPending: (upload) => set({ pending: upload }),
    clear: () => set({ pending: null }),
}));
