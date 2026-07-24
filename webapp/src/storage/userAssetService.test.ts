import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
    invokeFunction: vi.fn(),
    invokeFunctionUpload: vi.fn(),
}));
vi.mock('./blobCache', () => ({
    BlobCache: {
        evict: vi.fn(),
        put: vi.fn(),
    },
}));

import { UserAssetService } from './userAssetService';
import { invokeFunction } from '../api/client';
import { BlobCache } from './blobCache';

const invokeMock = vi.mocked(invokeFunction);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('UserAssetService.listAssets (/asset-list)', () => {
    it('returns the server assets including the downloadUrl enrichment', async () => {
        const asset = {
            id: 'a-1',
            assetType: 'background' as const,
            storagePath: 'u1/assets/a-1.webp',
            name: 'bg.webp',
            sizeBytes: 2048,
            createdAt: '2026-07-24T10:00:00Z',
            downloadUrl: 'https://s3/get/u1/assets/a-1.webp?sig=x',
        };
        invokeMock.mockResolvedValue({ data: { assets: [asset] }, error: null });

        const assets = await UserAssetService.listAssets('background');

        expect(invokeMock).toHaveBeenCalledExactlyOnceWith('asset-list', { assetType: 'background' });
        expect(assets).toEqual([asset]);
    });

    it('throws the API error', async () => {
        const error = new Error('boom');
        invokeMock.mockResolvedValue({ data: null, error });
        await expect(UserAssetService.listAssets('music')).rejects.toBe(error);
    });
});

describe('UserAssetService.deleteAsset (/asset-delete)', () => {
    it('deletes and evicts the returned storage path from the cache', async () => {
        invokeMock.mockResolvedValue({
            data: { storagePath: 'u1/assets/a-1.webp' },
            error: null,
        });

        await UserAssetService.deleteAsset('a-1');

        expect(invokeMock).toHaveBeenCalledExactlyOnceWith('asset-delete', { assetId: 'a-1' });
        expect(BlobCache.evict).toHaveBeenCalledExactlyOnceWith('u1/assets/a-1.webp');
    });

    it('skips eviction when the server returns null (not found / not owned)', async () => {
        invokeMock.mockResolvedValue({ data: { storagePath: null }, error: null });

        await UserAssetService.deleteAsset('a-x');

        expect(BlobCache.evict).not.toHaveBeenCalled();
    });
});
