import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudRenderService } from './cloudRenderService';
import { useActivityStore, renderTaskId } from './useActivityStore';
import { invokeFunction } from '../api/client';
import { CloudProjectService } from '../storage/cloudProjectService';
import { trackRenderInCloudCompleted, trackRenderInCloudFailed } from '../analytics';

// ─── Mocks ──────────────────────────────────────────────────

vi.mock('../api/client', () => ({ invokeFunction: vi.fn() }));
vi.mock('../storage/cloudProjectService', () => ({
    CloudProjectService: { saveProject: vi.fn(), getCloudVersion: vi.fn() },
}));
vi.mock('../auth/useUserStore', () => ({
    useUserStore: { getState: () => ({ userId: 'user-1' }) },
}));
vi.mock('../editor/stores/useProjectStore', () => ({
    useProjectStore: {
        getState: () => ({
            project: {
                id: 'p1',
                timeline: { durationMs: 12000 },
                screenSource: { size: { width: 1920, height: 1080 } },
                settings: { outputSize: { width: 1920, height: 1080 } },
            },
            userEvents: {},
        }),
    },
}));
vi.mock('../share/useProjectMetaStore', () => ({
    useProjectMetaStore: { getState: () => ({ meta: { slug: 'slug-1' } }) },
}));
vi.mock('../analytics', () => ({
    trackRenderInCloudCompleted: vi.fn(),
    trackRenderInCloudFailed: vi.fn(),
}));
vi.mock('../lib/sentry', () => ({ captureError: vi.fn() }));

// Browser bits the download path touches
const anchorClick = vi.fn();
vi.stubGlobal('navigator', { onLine: true });
vi.stubGlobal('document', { createElement: () => ({ click: anchorClick }) });
vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['mp4']) })));
vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });

// ─── Helpers ────────────────────────────────────────────────

const task = () => useActivityStore.getState().tasks[renderTaskId('p1')];
const mockInvoke = vi.mocked(invokeFunction) as unknown as ReturnType<typeof vi.fn>;

/** Queue responses in call order: render-job-create, then each status poll, then storage-download-urls */
function respond(...responses: unknown[]) {
    for (const r of responses) mockInvoke.mockResolvedValueOnce({ data: r, error: null });
}

const job = (status: string, progress: number | null = null, extra: Record<string, unknown> = {}) =>
    ({ job: { status, progress, error: null, render_storage_path: null, ...extra } });

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useActivityStore.setState({ tasks: {} });
    (CloudRenderService as unknown as { pollers: Map<string, unknown> }).pollers = new Map();
    vi.mocked(CloudProjectService.getCloudVersion).mockReturnValue(3);
});

afterEach(() => {
    vi.useRealTimers();
});

// ─── Tests ──────────────────────────────────────────────────

describe('CloudRenderService.start', () => {
    it('saves, creates the job, polls to completion and downloads — task ends completed', async () => {
        respond(
            { jobId: 'j1', status: 'pending', renderStoragePath: null },
            job('pending', 0.4),
            job('completed', 1, { render_storage_path: 'u/p1/renders/v3.mp4' }),
            { signedUrls: { 'u/p1/renders/v3.mp4': 'https://signed/v3.mp4' } },
        );

        await CloudRenderService.start('p1', 'My video', '1080p');

        expect(CloudProjectService.saveProject).toHaveBeenCalledOnce();
        expect(mockInvoke).toHaveBeenCalledWith('render-job-create', { projectId: 'p1', cloudVersion: 3, quality: '1080p' });
        expect(task()).toMatchObject({ kind: 'render', status: 'active', phase: 'queued', projectSlug: 'slug-1', quality: '1080p' });

        await vi.advanceTimersByTimeAsync(3000);
        expect(task()).toMatchObject({ phase: 'rendering', progress: 0.4 });

        await vi.advanceTimersByTimeAsync(3000);
        expect(task()).toMatchObject({ status: 'completed', phase: 'completed', progress: 1, renderStoragePath: 'u/p1/renders/v3.mp4' });
        expect(anchorClick).toHaveBeenCalledOnce();
        expect(trackRenderInCloudCompleted).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'p1', quality: '1080p', video_duration_s: 12 }));

        // Poller is gone: no further status calls
        const calls = mockInvoke.mock.calls.length;
        await vi.advanceTimersByTimeAsync(9000);
        expect(mockInvoke.mock.calls.length).toBe(calls);
    });

    it('a failed job marks the task failed with a retry and stops polling', async () => {
        respond(
            { jobId: 'j1', status: 'pending', renderStoragePath: null },
            { job: { status: 'failed', progress: 0.2, error: 'worker crashed', render_storage_path: null } },
        );

        await CloudRenderService.start('p1', 'My video');
        await vi.advanceTimersByTimeAsync(3000);

        expect(task()).toMatchObject({ status: 'failed', phase: 'failed', error: 'worker crashed' });
        expect(task().retry).toBeTypeOf('function');
        expect(trackRenderInCloudFailed).toHaveBeenCalledWith(expect.objectContaining({ phase: 'server_render', job_status: 'failed' }));
        expect(CloudRenderService.isActive('p1')).toBe(false);

        const calls = mockInvoke.mock.calls.length;
        await vi.advanceTimersByTimeAsync(9000);
        expect(mockInvoke.mock.calls.length).toBe(calls);
    });

    it('a rejected render-job-create fails the task with the server message', async () => {
        mockInvoke.mockResolvedValueOnce({ data: { error: 'subscription_required', message: 'Cloud export needs Pro' }, error: null });

        await CloudRenderService.start('p1', 'My video');

        expect(task()).toMatchObject({ status: 'failed', error: 'Cloud export needs Pro' });
        expect(trackRenderInCloudFailed).toHaveBeenCalledWith(expect.objectContaining({ phase: 'creating_job' }));
    });

    it('is a no-op while a render for the project is active', async () => {
        respond({ jobId: 'j1', status: 'pending', renderStoragePath: null });
        await CloudRenderService.start('p1', 'My video');
        const before = mockInvoke.mock.calls.length;

        await CloudRenderService.start('p1', 'My video');

        expect(mockInvoke.mock.calls.length).toBe(before);
        expect(CloudProjectService.saveProject).toHaveBeenCalledOnce();
    });

    it('a cache hit downloads straight away', async () => {
        respond(
            { jobId: 'j1', status: 'completed', renderStoragePath: 'u/p1/renders/v3.mp4' },
            { signedUrls: { 'u/p1/renders/v3.mp4': 'https://signed/v3.mp4' } },
        );

        await CloudRenderService.start('p1', 'My video');

        expect(task()).toMatchObject({ status: 'completed', phase: 'completed' });
        expect(anchorClick).toHaveBeenCalledOnce();
    });
});

describe('CloudRenderService.retry', () => {
    it('re-renders when the failure happened before a file existed', async () => {
        mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('offline') });
        await CloudRenderService.start('p1', 'My video', '4K');
        expect(task().status).toBe('failed');

        respond({ jobId: 'j2', status: 'pending', renderStoragePath: null });
        CloudRenderService.retry('p1');
        await vi.advanceTimersByTimeAsync(0);

        expect(mockInvoke).toHaveBeenLastCalledWith('render-job-create', expect.objectContaining({ quality: '4K' }));
        expect(task()).toMatchObject({ status: 'active', phase: 'queued' });
    });

    it('only re-downloads when the render itself succeeded', async () => {
        respond(
            { jobId: 'j1', status: 'completed', renderStoragePath: 'u/p1/renders/v3.mp4' },
            { error: 'expired' },
        );
        await CloudRenderService.start('p1', 'My video');
        expect(task()).toMatchObject({ status: 'failed', renderStoragePath: 'u/p1/renders/v3.mp4' });

        respond({ signedUrls: { 'u/p1/renders/v3.mp4': 'https://signed/v3.mp4' } });
        CloudRenderService.retry('p1');
        await vi.advanceTimersByTimeAsync(0);

        expect(mockInvoke).toHaveBeenLastCalledWith('storage-download-urls', { storagePaths: ['u/p1/renders/v3.mp4'] });
        expect(task().status).toBe('completed');
        expect(CloudProjectService.saveProject).toHaveBeenCalledOnce();
    });
});
