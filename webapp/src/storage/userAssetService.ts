import { supabase } from '../auth/AuthManager';
import { CloudStorage } from './cloudStorage';
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

/** MIME type for the signed URL upload based on file extension */
function mimeFromExt(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        webp: 'image/webp', avif: 'image/avif',
        mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
        m4a: 'audio/mp4', ogg: 'audio/ogg',
    };
    return map[ext] ?? 'application/octet-stream';
}

export class UserAssetService {
    /**
     * Full upload pipeline:
     * 1. Call asset-create edge function → get signed URL + pending row
     * 2. Upload blob to signed URL
     * 3. Call asset_confirm_upload RPC → flip status to ready
     * 4. Cache blob locally via BlobCache
     */
    static async uploadAsset(
        file: File,
        type: 'background' | 'music',
        onProgress?: (fraction: number) => void,
    ): Promise<UserAsset> {
        if (!supabase) throw new Error('Supabase not configured');

        // 1. Create asset record + get signed URL
        const { data, error } = await supabase.functions.invoke('asset-create', {
            body: {
                assetType: type,
                sizeBytes: file.size,
                fileName: file.name,
            },
        });

        if (error) throw error;
        if (data?.error) {
            if (data.error === 'library_full') {
                throw new AssetLibraryFullError(type, data.count, data.limit);
            }
            throw new Error(data.message ?? data.error);
        }

        const { signedUrl, storagePath, assetId } = data;

        // 2. Upload blob
        await CloudStorage.uploadBlob(
            signedUrl,
            file,
            mimeFromExt(file.name),
            onProgress,
        );

        // 3. Confirm upload → pending → ready
        const { data: confirmed, error: confirmError } = await supabase
            .rpc('asset_confirm_upload', { p_asset_id: assetId });

        if (confirmError) throw confirmError;
        if (!confirmed) throw new Error('Failed to confirm asset upload');

        // 4. Cache locally so we don't re-download immediately
        await BlobCache.put(storagePath, file);

        return {
            id: assetId,
            assetType: type,
            storagePath,
            name: file.name,
            sizeBytes: file.size,
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
