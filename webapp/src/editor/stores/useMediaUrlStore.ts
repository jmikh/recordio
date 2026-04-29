import { create } from 'zustand';

interface MediaUrlState {
    /** Blob URLs keyed by source ID */
    urls: Record<string, string>;

    setUrl: (sourceId: string, url: string) => void;
    revokeAll: () => void;
}

export const useMediaUrlStore = create<MediaUrlState>()((set, get) => ({
    urls: {},

    setUrl: (sourceId, url) => set(state => ({
        urls: { ...state.urls, [sourceId]: url },
    })),

    revokeAll: () => {
        const { urls } = get();
        for (const url of Object.values(urls)) {
            if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        }
        set({ urls: {} });
    },
}));
