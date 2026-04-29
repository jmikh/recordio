import { create } from 'zustand';
import { UserAssetService, type UserAsset } from '../../storage/userAssetService';
import { BlobCache } from '../../storage/blobCache';

const LIBRARY_LIMIT = 10;

interface AssetLibraryState {
    backgrounds: UserAsset[];
    music: UserAsset[];
    /** Blob URLs keyed by storagePath (for thumbnails/preview) */
    blobUrls: Record<string, string>;
    isLoaded: boolean;

    /** Load both libraries from the server. Called once on project open. */
    load: () => Promise<void>;

    /** Add an asset (after successful upload). Updates state optimistically. */
    addAsset: (asset: UserAsset) => void;

    /** Remove an asset (soft delete). Updates state optimistically. */
    removeAsset: (id: string, storagePath: string) => Promise<void>;

    canUploadBackground: () => boolean;
    canUploadMusic: () => boolean;

    /** Resolve a blob URL for an asset's storagePath. Caches the result. */
    resolveBlobUrl: (storagePath: string) => Promise<string>;
}

export const useAssetLibraryStore = create<AssetLibraryState>()((set, get) => ({
    backgrounds: [],
    music: [],
    blobUrls: {},
    isLoaded: false,

    load: async () => {
        try {
            const [backgrounds, music] = await Promise.all([
                UserAssetService.listAssets('background'),
                UserAssetService.listAssets('music'),
            ]);
            set({ backgrounds, music, isLoaded: true });

            // Pre-resolve blob URLs for all assets in background
            const allAssets = [...backgrounds, ...music];
            for (const asset of allAssets) {
                get().resolveBlobUrl(asset.storagePath).catch(() => {});
            }
        } catch (err) {
            console.error('Failed to load asset library:', err);
        }
    },

    addAsset: (asset) => {
        set(state => {
            const key = asset.assetType === 'background' ? 'backgrounds' : 'music';
            return { [key]: [asset, ...state[key]] };
        });
        // Resolve blob URL in background (blob is already in BlobCache from upload)
        get().resolveBlobUrl(asset.storagePath).catch(() => {});
    },

    removeAsset: async (id, storagePath) => {
        // Optimistic removal from state
        set(state => ({
            backgrounds: state.backgrounds.filter(a => a.id !== id),
            music: state.music.filter(a => a.id !== id),
        }));

        // Revoke blob URL
        const { blobUrls } = get();
        if (blobUrls[storagePath]) {
            URL.revokeObjectURL(blobUrls[storagePath]);
            set(state => {
                const { [storagePath]: _, ...rest } = state.blobUrls;
                return { blobUrls: rest };
            });
        }

        // Server-side delete
        await UserAssetService.deleteAsset(id);
    },

    canUploadBackground: () => get().backgrounds.length < LIBRARY_LIMIT,
    canUploadMusic: () => get().music.length < LIBRARY_LIMIT,

    resolveBlobUrl: async (storagePath) => {
        const existing = get().blobUrls[storagePath];
        if (existing) return existing;

        const url = await BlobCache.getBlobUrl(storagePath);
        set(state => ({ blobUrls: { ...state.blobUrls, [storagePath]: url } }));
        return url;
    },
}));
