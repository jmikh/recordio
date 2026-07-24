import { create } from 'zustand';
import { UserAssetService, type UserAsset } from '../../storage/userAssetService';
import { BlobCache } from '../../storage/blobCache';
import { captureError } from '../../lib/sentry';

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

            // Pre-resolve blob URLs for all assets in a single batch,
            // downloading misses via the presigned URLs asset_list returned
            const all = [...backgrounds, ...music];
            if (all.length > 0) {
                const knownUrls: Record<string, string> = {};
                for (const a of all) {
                    if (a.downloadUrl) knownUrls[a.storagePath] = a.downloadUrl;
                }
                BlobCache.getBlobUrls(all.map(a => a.storagePath), knownUrls)
                    .then(urls => set(state => ({ blobUrls: { ...state.blobUrls, ...urls } })))
                    .catch(() => {});
            }
        } catch (err) {
            captureError(err, { flow: 'asset_library', phase: 'load' });
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

        const findAsset = () =>
            [...get().backgrounds, ...get().music].find(a => a.storagePath === storagePath);

        let url: string;
        try {
            url = await BlobCache.getBlobUrl(storagePath, undefined, findAsset()?.downloadUrl);
        } catch (err) {
            // Likely an expired download URL (a cache miss resolved >1h
            // after listing): refresh the list once for fresh URLs and
            // retry, then give up. The list is the only URL source — no
            // fallback to /storage-download-urls for assets.
            const asset = findAsset();
            if (!asset) throw err;
            const fresh = await UserAssetService.listAssets(asset.assetType);
            set(asset.assetType === 'background' ? { backgrounds: fresh } : { music: fresh });
            const refreshed = fresh.find(a => a.storagePath === storagePath);
            if (!refreshed) throw err; // gone server-side
            url = await BlobCache.getBlobUrl(storagePath, undefined, refreshed.downloadUrl);
        }
        set(state => ({ blobUrls: { ...state.blobUrls, [storagePath]: url } }));
        return url;
    },
}));
