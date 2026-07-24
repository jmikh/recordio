import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudProjectService } from './cloudProjectService';
import { CloudStorage, CloudVersionConflictError } from './cloudStorage';
import { BlobCache } from './blobCache';
import { useSyncStatusStore } from './syncStatusStore';

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
        getBlobUrl: vi.fn(),
        getBlobUrls: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('@sentry/react', () => ({
    captureException: vi.fn(),
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
    // Reset sync status store
    useSyncStatusStore.getState().setPendingMediaUploads(0);
    useSyncStatusStore.getState().setIdle();
    useSyncStatusStore.getState().clearConflict();
});

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

    it('skips save when media uploads are pending', async () => {
        const project = makeProject();
        useSyncStatusStore.getState().setPendingMediaUploads(2);

        await CloudProjectService.saveProject(project, 'user-1');

        expect(CloudStorage.saveProjectMetadata).not.toHaveBeenCalled();
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
            project, 'user-1', 5, true
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
        vi.mocked(CloudStorage.listProjectsSummary).mockResolvedValue([{
            id: 'p1',
            name: 'Test',
            created_by: 'user-1',
            owner_id: 'user-1',
            workspace_id: 'workspace-1',
            thumbnail_storage_path: 'path/thumb.webp',
            updated_at: '2024-01-01',
            created_at: '2024-01-01',
            last_accessed_at: '2024-01-01',
            expires_at: null,
            deleted_at: null,
            is_shared: false,
            cloud_version: 1,
            duration_ms: 5000,
            slug: null,
            share_policy: 'public',
        }]);

        const items = await CloudProjectService.listProjects('workspace-1');

        expect(items).toHaveLength(1);
        expect(items[0].id).toBe('p1');
        expect(items[0].name).toBe('Test');
        expect(items[0].thumbnailStoragePath).toBe('path/thumb.webp');
        expect(items[0].durationMs).toBe(5000);
    });
});
