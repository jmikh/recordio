import { supabase } from '../auth/AuthManager';
import { invokeFunctionUpload } from '../api/client';
import { BlobCache } from './blobCache';

export interface UserAsset {
    id: string;
    assetType: 'background' | 'music';
    storagePath: string;
    name: string | null;
    sizeBytes: number;
    createdAt: string;
}

const LIBRARY_LIMIT = 10; // per asset type
const MAX_DIMENSION = 1920; // 1080p cap

/** Compress an image file to WebP, capping at 4K while maintaining aspect ratio. */
async function compressImageToWebP(file: File): Promise<{ blob: Blob; fileName: string }> {
    const img = await createImageBitmap(file);
    let { width, height } = img;

    // Downscale to fit within 4K while maintaining aspect ratio
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, width, height);
    img.close();

    const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
    const fileName = file.name.replace(/\.\w+$/, '.webp');
    return { blob: webpBlob, fileName };
}

export class UserAssetService {
    /**
     * Single-request upload: one multipart POST to /asset-upload — the
     * server validates, stores the bytes in S3 and inserts the row as
     * 'ready'. Progress reflects client→server transfer; the server→S3
     * leg happens after 100% and is negligible at these sizes.
     */
    static async uploadAsset(
        file: File,
        type: 'background' | 'music',
        onProgress?: (fraction: number) => void,
    ): Promise<UserAsset> {
        // Compress background images to WebP before upload
        let uploadBlob: Blob = file;
        let uploadFileName = file.name;
        if (type === 'background') {
            const compressed = await compressImageToWebP(file);
            uploadBlob = compressed.blob;
            uploadFileName = compressed.fileName;
        }

        const form = new FormData();
        form.append('assetType', type);
        form.append('file', uploadBlob, uploadFileName);

        // library_full comes back as 200 with the rich body;
        // error/message/count/limit are only present on that response
        const { data, error } = await invokeFunctionUpload<{
            assetId: string;
            storagePath: string;
            error?: string;
            message?: string;
            count: number;
            limit: number;
        }>('asset-upload', form, onProgress);

        if (error) throw error;
        if (data?.error) {
            if (data.error === 'library_full') {
                throw new AssetLibraryFullError(type, data.count, data.limit);
            }
            throw new Error(data.message ?? data.error);
        }

        const { assetId, storagePath } = data;

        // Cache locally so we don't re-download immediately
        await BlobCache.put(storagePath, uploadBlob);

        return {
            id: assetId,
            assetType: type,
            storagePath,
            name: uploadFileName,
            sizeBytes: uploadBlob.size,
            createdAt: new Date().toISOString(),
        };
    }

    /**
     * List active assets for a given type (ready + not deleted).
     */
    static async listAssets(type: 'background' | 'music'): Promise<UserAsset[]> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data, error } = await supabase.rpc('asset_list', {
            p_asset_type: type,
        });

        if (error) throw error;

        return (data ?? []).map((row: any) => ({
            id: row.id,
            assetType: row.asset_type,
            storagePath: row.storage_path,
            name: row.name,
            sizeBytes: row.size_bytes,
            createdAt: row.created_at,
        }));
    }

    /**
     * Soft-delete an asset (is_deleted = true). Evicts from local cache.
     */
    static async deleteAsset(id: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not configured');

        const { data: storagePath, error } = await supabase.rpc('asset_delete', {
            p_asset_id: id,
        });

        if (error) throw error;

        if (storagePath) {
            await BlobCache.evict(storagePath);
        }
    }

    /**
     * Check if the user can upload another asset of the given type.
     */
    static async canUpload(type: 'background' | 'music'): Promise<boolean> {
        const assets = await this.listAssets(type);
        return assets.length < LIBRARY_LIMIT;
    }
}

export class AssetLibraryFullError extends Error {
    constructor(
        public assetType: string,
        public count: number,
        public limit: number,
    ) {
        super(`${assetType} library full (${count}/${limit})`);
        this.name = 'AssetLibraryFullError';
    }
}
