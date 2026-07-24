import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserAsset } from '../../storage/userAssetService';

vi.mock('../../storage/userAssetService', () => ({
    UserAssetService: {
        listAssets: vi.fn(),
        deleteAsset: vi.fn(),
    },
}));
vi.mock('../../storage/blobCache', () => ({
    BlobCache: {
        getBlobUrl: vi.fn(),
        getBlobUrls: vi.fn(),
    },
}));
vi.mock('../../lib/sentry', () => ({
    captureError: vi.fn(),
}));

import { useAssetLibraryStore } from './useAssetLibraryStore';
import { UserAssetService } from '../../storage/userAssetService';
import { BlobCache } from '../../storage/blobCache';

const listAssetsMock = vi.mocked(UserAssetService.listAssets);
const getBlobUrlMock = vi.mocked(BlobCache.getBlobUrl);
const getBlobUrlsMock = vi.mocked(BlobCache.getBlobUrls);

function asset(overrides: Partial<UserAsset> = {}): UserAsset {
    return {
        id: 'a-1',
        assetType: 'background',
        storagePath: 'u1/assets/a-1.webp',
        name: 'bg',
        sizeBytes: 1,
        createdAt: 't',
        downloadUrl: 'https://s3/get/a-1?sig=fresh',
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    useAssetLibraryStore.setState({
        backgrounds: [], music: [], blobUrls: {}, isLoaded: false,
    });
});

describe('load', () => {
    it('pre-resolves via getBlobUrls with the download URLs asset_list returned', async () => {
        const bg = asset();
        const song = asset({
            id: 'a-2', assetType: 'music', storagePath: 'u1/assets/a-2.mp3',
            downloadUrl: undefined, // e.g. supabase fallback row
        });
        listAssetsMock.mockImplementation(async (type) =>
            type === 'background' ? [bg] : [song]);
        getBlobUrlsMock.mockResolvedValue({ [bg.storagePath]: 'blob:bg' });

        await useAssetLibraryStore.getState().load();

        expect(getBlobUrlsMock).toHaveBeenCalledExactlyOnceWith(
            [bg.storagePath, song.storagePath],
            { [bg.storagePath]: bg.downloadUrl }, // only rows WITH a url
        );
        await vi.waitFor(() =>
            expect(useAssetLibraryStore.getState().blobUrls[bg.storagePath]).toBe('blob:bg'));
    });
});

describe('resolveBlobUrl', () => {
    it('passes the asset download URL through to BlobCache on a cache miss', async () => {
        const bg = asset();
        useAssetLibraryStore.setState({ backgrounds: [bg] });
        getBlobUrlMock.mockResolvedValue('blob:1');

        const url = await useAssetLibraryStore.getState().resolveBlobUrl(bg.storagePath);

        expect(url).toBe('blob:1');
        expect(getBlobUrlMock).toHaveBeenCalledExactlyOnceWith(
            bg.storagePath, undefined, bg.downloadUrl);
        expect(useAssetLibraryStore.getState().blobUrls[bg.storagePath]).toBe('blob:1');
    });

    it('retries ONCE with a refreshed list when the download fails (expired URL)', async () => {
        const stale = asset({ downloadUrl: 'https://s3/get/a-1?sig=stale' });
        const fresh = asset({ downloadUrl: 'https://s3/get/a-1?sig=fresh2' });
        useAssetLibraryStore.setState({ backgrounds: [stale] });
        getBlobUrlMock
            .mockRejectedValueOnce(new Error('403'))
            .mockResolvedValueOnce('blob:retried');
        listAssetsMock.mockResolvedValue([fresh]);

        const url = await useAssetLibraryStore.getState().resolveBlobUrl(stale.storagePath);

        expect(url).toBe('blob:retried');
        expect(listAssetsMock).toHaveBeenCalledExactlyOnceWith('background');
        expect(getBlobUrlMock).toHaveBeenNthCalledWith(2,
            stale.storagePath, undefined, fresh.downloadUrl);
        // The refreshed list replaced the stale one
        expect(useAssetLibraryStore.getState().backgrounds).toEqual([fresh]);
    });

    it('gives up after the single retry', async () => {
        useAssetLibraryStore.setState({ backgrounds: [asset()] });
        getBlobUrlMock.mockRejectedValue(new Error('still failing'));
        listAssetsMock.mockResolvedValue([asset()]);

        await expect(
            useAssetLibraryStore.getState().resolveBlobUrl(asset().storagePath),
        ).rejects.toThrow('still failing');
        expect(getBlobUrlMock).toHaveBeenCalledTimes(2);
        expect(listAssetsMock).toHaveBeenCalledTimes(1);
    });

    it('rethrows without a refresh when the asset vanished from the refreshed list', async () => {
        const gone = asset();
        useAssetLibraryStore.setState({ backgrounds: [gone] });
        getBlobUrlMock.mockRejectedValue(new Error('403'));
        listAssetsMock.mockResolvedValue([]); // deleted on another device

        await expect(
            useAssetLibraryStore.getState().resolveBlobUrl(gone.storagePath),
        ).rejects.toThrow('403');
        expect(getBlobUrlMock).toHaveBeenCalledTimes(1);
    });

    it('does not attempt a refresh for a path with no matching asset', async () => {
        getBlobUrlMock.mockRejectedValue(new Error('boom'));

        await expect(
            useAssetLibraryStore.getState().resolveBlobUrl('unknown/path'),
        ).rejects.toThrow('boom');
        expect(listAssetsMock).not.toHaveBeenCalled();
    });
});
