import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudProjectService } from './cloudProjectService';
import { CloudStorage, CloudVersionConflictError } from './cloudStorage';
import { BlobCache } from './blobCache';
import { useSyncStatusStore } from './syncStatusStore';
import { useActivityStore, uploadTaskId } from '../activity/useActivityStore';
import type { CloudProjectSummary } from '@shared/api';

// ─── Mocks ──────────────────────────────────────────────────

vi.mock('./cloudStorage', () => ({
    CloudStorage: {
        saveProjectMetadata: vi.fn(),
        loadProjectMetadata: vi.fn(),
        listProjectsSummary: vi.fn(),
        softDeleteProject: vi.fn(),
        restoreProject: vi.fn(),
        getCloudVersion: vi.fn(),
        confirmProjectUpload: vi.fn(),
        uploadThumbnail: vi.fn(),
        uploadBlobResumable: vi.fn(),
    },
    CloudVersionConflictError: class extends Error {
        projectId: string;
        constructor(projectId: string) {
            super('conflict');
            this.projectId = projectId;
        }
    },
}));

vi.mock('./blobCache', () => ({
    BlobCache: {
        put: vi.fn(),
        has: vi.fn().mockResolvedValue(false),
        getBlobIfCached: vi.fn().mockResolvedValue(null),
        getBlobUrl: vi.fn(),
        getBlobUrls: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('@sentry/react', () => ({
    captureException: vi.fn(),
    addBreadcrumb: vi.fn(),
    withScope: vi.fn(),
}));

vi.mock('./useMediaUrlStore', () => ({
    useMediaUrlStore: {
        getState: () => ({ setUrl: vi.fn() }),
    },
}));

vi.mock('../core/migrateProject', () => ({
    migrateProject: vi.fn((raw: any) => raw),
}));

vi.mock('../core/Project', () => ({
    ProjectImpl: {
        createFromSource: vi.fn(),
    },
    CURRENT_SCHEMA_VERSION: 5,
}));

vi.mock('./projectBlobs', () => ({
    cloudStoragePath: vi.fn((userId: string, projectId: string, type: string) => `${userId}/${projectId}/${type}.webm`),
    hydrateMediaUrls: vi.fn(),
}));

// Stub crypto.subtle for Node (projectDataHash uses SHA-256)
let hashCounter = 0;
vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    subtle: {
        digest: vi.fn(async () => new Uint8Array([hashCounter++, 1, 2, 3]).buffer),
    },
    randomUUID: () => `uuid-${hashCounter++}`,
});

// ─── Helpers ────────────────────────────────────────────────

function makeProject(id = 'proj-1') {
    return {
        id,
        schemaVersion: 6,
        autoEffectsGenerated: true,
        screenSource: { storagePath: 'u/p/screen.webm', durationMs: 10000, size: { width: 1920, height: 1080 }, hasAudio: true },
        userEvents: { mouseClicks: [], mousePositions: [], keyboardEvents: [], drags: [], scrolls: [], typingEvents: [], urlChanges: [], hoveredCards: [] },
        settings: {} as any,
        timeline: { id: 't1', durationMs: 10000, outputWindows: [] } as any,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    hashCounter = 0;
    // Reset internal state
    (CloudProjectService as any).cloudVersions = new Map();
    (CloudProjectService as any).projectHashes = new Map();
    (CloudProjectService as any).saveInFlight = new Set();
    (CloudProjectService as any).thumbnailHashes = new Map();
    (CloudProjectService as any).activeUploads = new Map();
    // Reset stores
    useSyncStatusStore.getState().setPendingMediaUploads(0);
    useSyncStatusStore.getState().setIdle();
    useSyncStatusStore.getState().clearConflict();
    useActivityStore.setState({ tasks: {} });
});

function makeSummary(over: Partial<CloudProjectSummary> = {}): CloudProjectSummary {
    return {
        id: 'p1',
        name: 'Test',
        created_by: 'user-1',
        owner_id: 'user-1',
        workspace_id: 'workspace-1',
        thumbnail_storage_path: 'path/thumb.webp',
        updated_at: '2024-01-01',
        created_at: '2024-01-01',
        last_accessed_at: '2024-01-01',
        deleted_at: null,
        is_shared: true,
        cloud_version: 1,
        duration_ms: 5000,
        slug: 'abc123def456',
        share_policy: 'public',
        workspace_access: 'view',
        is_editor: true,
        editor_role: 'edit',
        upload_status: 'ready',
        ...over,
    };
}

// ==========================================
// saveProject
// ==========================================

describe('CloudProjectService.saveProject', () => {
    it('saves to cloud and updates version + hash', async () => {
        const project = makeProject();
        vi.mocked(CloudStorage.saveProjectMetadata).mockResolvedValue({ cloudVersion: 2 });

        await CloudProjectService.saveProject(project, 'user-1');

        expect(CloudStorage.saveProjectMetadata).toHaveBeenCalledOnce();
        expect(CloudProjectService.getCloudVersion('proj-1')).toBe(2);
    });

    it('skips save when hash matches (no-op)', async () => {
        const project = makeProject();
        vi.mocked(CloudStorage.saveProjectMetadata).mockResolvedValue({ cloudVersion: 1 });

        // First save: stores hash
        await CloudProjectService.saveProject(project, 'user-1');
        expect(CloudStorage.saveProjectMetadata).toHaveBeenCalledOnce();

        // Second save with same hash: skipped
        // Need same hash — reset counter so digest returns same value
        hashCounter = 0;
        // But hash was already stored from first save, so we need the digest to return the same hash
        // Actually the mock returns incrementing values, so we need to mock it differently
        const savedHash = (CloudProjectService as any).projectHashes.get('proj-1');
        // Override digest to return the same hash
        vi.mocked(crypto.subtle.digest).mockResolvedValue(
            new Uint8Array(savedHash.match(/.{2}/g)!.map((b: string) => parseInt(b, 16))).buffer
        );

        await CloudProjectService.saveProject(project, 'user-1');
        // Still only called once (from first save)
        expect(CloudStorage.saveProjectMetadata).toHaveBeenCalledOnce();
    });

    it('skips concurrent saves for same project when in-flight guard is set', async () => {
        const project = makeProject();

        // Simulate a save already in flight
        (CloudProjectService as any).saveInFlight.add('proj-1');

        await CloudProjectService.saveProject(project, 'user-1');

        // Should not have called CloudStorage because save was in flight
        expect(CloudStorage.saveProjectMetadata).not.toHaveBeenCalled();

        // Clean up
        (CloudProjectService as any).saveInFlight.delete('proj-1');
    });

    it('sets conflict state on CloudVersionConflictError', async () => {
        const project = makeProject();
        vi.mocked(CloudStorage.saveProjectMetadata).mockRejectedValue(
            new CloudVersionConflictError('proj-1', 1)
        );

        await CloudProjectService.saveProject(project, 'user-1');

        const state = useSyncStatusStore.getState();
        expect(state.conflict).toEqual({ projectId: 'proj-1' });
    });

    it('passes expected version to CloudStorage', async () => {
        const project = makeProject();
        // Set a known cloud version
        (CloudProjectService as any).cloudVersions.set('proj-1', 5);
        vi.mocked(CloudStorage.saveProjectMetadata).mockResolvedValue({ cloudVersion: 6 });

        await CloudProjectService.saveProject(project, 'user-1');

        expect(CloudStorage.saveProjectMetadata).toHaveBeenCalledWith(
            project, 'user-1', 5,
        );
    });

    it('clears in-flight guard even on error', async () => {
        const project = makeProject();
        vi.mocked(CloudStorage.saveProjectMetadata).mockRejectedValue(new Error('network'));

        await CloudProjectService.saveProject(project, 'user-1');

        // Should be able to save again (in-flight guard cleared)
        vi.mocked(CloudStorage.saveProjectMetadata).mockResolvedValue({ cloudVersion: 1 });
        hashCounter = 100; // different hash
        await CloudProjectService.saveProject(project, 'user-1');
        expect(CloudStorage.saveProjectMetadata).toHaveBeenCalledTimes(2);
    });
});

// ==========================================
// deleteProject
// ==========================================

describe('CloudProjectService.deleteProject', () => {
    it('calls CloudStorage.softDeleteProject and clears local state', async () => {
        (CloudProjectService as any).cloudVersions.set('proj-1', 3);
        (CloudProjectService as any).projectHashes.set('proj-1', 'abc');

        await CloudProjectService.deleteProject('proj-1');

        expect(CloudStorage.softDeleteProject).toHaveBeenCalledWith('proj-1');
        expect(CloudProjectService.getCloudVersion('proj-1')).toBeUndefined();
    });
});

// ==========================================
// listProjects
// ==========================================

describe('CloudProjectService.listProjects', () => {
    it('maps cloud summaries to ProjectListItems', async () => {
        vi.mocked(CloudStorage.listProjectsSummary).mockResolvedValue([makeSummary()]);

        const items = await CloudProjectService.listProjects('workspace-1');

        expect(items).toHaveLength(1);
        expect(items[0].id).toBe('p1');
        expect(items[0].name).toBe('Test');
        expect(items[0].thumbnailStoragePath).toBe('path/thumb.webp');
        expect(items[0].durationMs).toBe(5000);
        expect(items[0].sharePolicy).toBe('public');
        expect(items[0].isEditor).toBe(true);
        expect(items[0].uploadStatus).toBe('ready');
        expect(items[0].mediaPaths).toBeNull();
        expect(BlobCache.has).not.toHaveBeenCalled();
    });

    const pendingPaths = [
        { storagePath: 'u/p2/screen.webm', type: 'screen' as const },
        { storagePath: 'u/p2/mic.wav', type: 'mic' as const },
    ];

    it('keeps a pending project when every media file is in BlobCache', async () => {
        vi.mocked(CloudStorage.listProjectsSummary).mockResolvedValue([
            makeSummary({ id: 'p2', upload_status: 'pending', media_paths: pendingPaths }),
        ]);
        vi.mocked(BlobCache.has).mockResolvedValue(true);

        const items = await CloudProjectService.listProjects('workspace-1');

        expect(items.map(i => i.id)).toEqual(['p2']);
        expect(items[0]).toMatchObject({ uploadStatus: 'pending', mediaPaths: pendingPaths });
        expect(BlobCache.has).toHaveBeenCalledTimes(2);
    });

    it('drops a pending project when any media file is missing locally, keeps ready ones', async () => {
        vi.mocked(CloudStorage.listProjectsSummary).mockResolvedValue([
            makeSummary({ id: 'p1' }),
            makeSummary({ id: 'p2', upload_status: 'pending', media_paths: pendingPaths }),
            makeSummary({ id: 'p3', upload_status: 'pending', media_paths: [] }),
        ]);
        vi.mocked(BlobCache.has).mockImplementation(async (path: string) => path.endsWith('screen.webm'));

        const items = await CloudProjectService.listProjects('workspace-1');

        expect(items.map(i => i.id)).toEqual(['p1']);
    });
});

// ==========================================
// Upload tasks (activity store bridge)
// ==========================================

const blob = (size: number) => new Blob([new Uint8Array(size)]);
const uploads = [{ fileType: 'screen', storagePath: 'u/p1/screen.webm' }];
const blobs = [{ fileType: 'screen', blob: blob(10) }];

describe('CloudProjectService.startMediaUpload', () => {
    it('runs an upload task active → completed and confirms the project', async () => {
        vi.mocked(CloudStorage.uploadBlobResumable).mockImplementation(async (_b, _p, _blob, _mime, onProgress) => {
            onProgress?.(0.5);
        });

        const promise = CloudProjectService.startMediaUpload('p1', 'My video', 'project-media', uploads, blobs, 'slug-1');
        expect(CloudProjectService.isUploadActive('p1')).toBe(true);
        expect(useActivityStore.getState().tasks[uploadTaskId('p1')]).toMatchObject({
            kind: 'upload', status: 'active', projectSlug: 'slug-1', projectName: 'My video',
        });

        await promise;

        expect(CloudStorage.confirmProjectUpload).toHaveBeenCalledWith('p1');
        expect(CloudProjectService.isUploadActive('p1')).toBe(false);
        expect(useActivityStore.getState().tasks[uploadTaskId('p1')]).toMatchObject({
            status: 'completed', progress: 1,
        });
    });

    it('marks the task failed with a retry that restarts the upload', async () => {
        vi.mocked(CloudStorage.uploadBlobResumable).mockRejectedValue(new Error('network down'));

        await CloudProjectService.startMediaUpload('p1', 'My video', 'project-media', uploads, blobs);

        const failed = useActivityStore.getState().tasks[uploadTaskId('p1')];
        expect(failed).toMatchObject({ status: 'failed', error: 'network down' });
        expect(CloudStorage.confirmProjectUpload).not.toHaveBeenCalled();

        vi.mocked(CloudStorage.uploadBlobResumable).mockResolvedValue(undefined);
        failed.retry!();
        expect(useActivityStore.getState().tasks[uploadTaskId('p1')].status).toBe('active');
        await (CloudProjectService as any).activeUploads.get('p1');
        expect(useActivityStore.getState().tasks[uploadTaskId('p1')].status).toBe('completed');
    });

    it('dedupes: a second start while active returns the same promise', async () => {
        vi.mocked(CloudStorage.uploadBlobResumable).mockResolvedValue(undefined);
        const a = CloudProjectService.startMediaUpload('p1', 'My video', 'project-media', uploads, blobs);
        const b = CloudProjectService.startMediaUpload('p1', 'My video', 'project-media', uploads, blobs);
        expect(a).toBe(b);
        await a;
    });
});

describe('CloudProjectService.saveProject gate', () => {
    it('holds saves only for the project whose upload is in flight', async () => {
        let release!: () => void;
        vi.mocked(CloudStorage.uploadBlobResumable).mockImplementation(() => new Promise<void>(r => { release = r; }));
        vi.mocked(CloudStorage.saveProjectMetadata).mockResolvedValue({ cloudVersion: 2 });
        const uploading = CloudProjectService.startMediaUpload('p1', 'A', 'project-media', uploads, blobs);

        await CloudProjectService.saveProject(makeProject('p1'), 'user-1');
        expect(CloudStorage.saveProjectMetadata).not.toHaveBeenCalled();

        await CloudProjectService.saveProject(makeProject('p2'), 'user-1');
        expect(CloudStorage.saveProjectMetadata).toHaveBeenCalledTimes(1);

        release();
        await uploading;
    });
});

describe('CloudProjectService.resumePendingUploads', () => {
    it('restarts uploads for listed pending projects from BlobCache and skips the rest', async () => {
        vi.mocked(BlobCache.getBlobIfCached).mockResolvedValue(blob(4));
        vi.mocked(CloudStorage.uploadBlobResumable).mockResolvedValue(undefined);
        const base = { name: 'X', thumbnail: null, thumbnailStoragePath: null, updatedAt: '', createdAt: '', lastAccessedAt: null,
            ownerId: 'user-1', deletedAt: null, isShared: false, cloudVersion: 1, durationMs: null, shareSlug: 'slug',
            sharePolicy: null, workspaceAccess: null, isEditor: false, editorRole: null } as const;

        CloudProjectService.resumePendingUploads([
            { ...base, id: 'ready', uploadStatus: 'ready', mediaPaths: null },
            { ...base, id: 'pending', uploadStatus: 'pending', mediaPaths: [{ storagePath: 'u/pending/screen.webm', type: 'screen' }] },
        ]);
        // resumeUploadFromPaths awaits the cache read before starting; with
        // every collaborator mocked the upload then finishes immediately
        await vi.waitFor(() =>
            expect(useActivityStore.getState().tasks[uploadTaskId('pending')]).toMatchObject({ status: 'completed', projectSlug: 'slug' }));

        expect(useActivityStore.getState().tasks[uploadTaskId('ready')]).toBeUndefined();
        expect(CloudStorage.uploadBlobResumable).toHaveBeenCalledTimes(1);
        expect(CloudStorage.uploadBlobResumable).toHaveBeenCalledWith(
            'project-media', 'u/pending/screen.webm', expect.any(Blob), 'video/webm', expect.any(Function),
        );
    });
});
