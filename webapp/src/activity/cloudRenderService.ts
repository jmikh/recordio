import { invokeFunction } from '../api/client';
import { useUserStore } from '../auth/useUserStore';
import { useProjectStore } from '../editor/stores/useProjectStore';
import { useProjectMetaStore } from '../share/useProjectMetaStore';
import { CloudProjectService } from '../storage/cloudProjectService';
import { trackRenderInCloudCompleted, trackRenderInCloudFailed } from '../analytics';
import { captureError } from '../lib/sentry';
import type { ExportQuality } from '@shared/utils/exportQuality';
import { useActivityStore, renderTaskId, type RenderTask } from './useActivityStore';

const POLL_INTERVAL_MS = 3000;

interface ProjectMeta {
    video_duration_s: number;
    input_resolution: string;
    output_resolution: string;
}

function getProjectMeta(): ProjectMeta {
    const proj = useProjectStore.getState().project;
    return {
        video_duration_s: Math.round(proj.timeline.durationMs / 1000),
        input_resolution: `${proj.screenSource.size.width}x${proj.screenSource.size.height}`,
        output_resolution: `${proj.settings.outputSize.width}x${proj.settings.outputSize.height}`,
    };
}

type FailPhase = 'saving_project' | 'creating_job' | 'polling_status' | 'server_render' | 'downloading';

/** HTTP status off a FunctionsHttpError-shaped error, if any */
function httpStatus(error: unknown): number | undefined {
    const ctx = (error as { context?: { status?: number } } | null)?.context;
    return ctx?.status;
}

/** The bits of a thrown value the failure analytics carry */
function errorInfo(e: unknown, fallback: string) {
    const err = e as { message?: string; name?: string; stack?: string } | null;
    return {
        message: err?.message || fallback,
        name: err?.name,
        stack: typeof err?.stack === 'string' ? err.stack.split('\n').slice(0, 5).join('\n') : undefined,
    };
}

/**
 * Cloud render orchestration, page-independent (plans/background-activity-
 * oneshot.md). Lives at module level so a render started in the editor
 * keeps polling and downloads after the user navigates away; state is
 * reported through useActivityStore, where the editor's Download button
 * and ActivityToasts read it. One render per project at a time.
 *
 * Refresh mid-render is not survived (out of scope): the server job
 * finishes anyway and the next identical render-job-create is a cache hit.
 */
export class CloudRenderService {
    private static pollers = new Map<string, ReturnType<typeof setInterval>>();

    static isActive(projectId: string): boolean {
        return useActivityStore.getState().tasks[renderTaskId(projectId)]?.status === 'active';
    }

    private static task(projectId: string): RenderTask | undefined {
        return useActivityStore.getState().tasks[renderTaskId(projectId)] as RenderTask | undefined;
    }

    private static patch(projectId: string, patch: Partial<RenderTask>) {
        useActivityStore.getState().patchTask(renderTaskId(projectId), patch);
    }

    private static stopPolling(projectId: string) {
        const poller = this.pollers.get(projectId);
        if (poller) {
            clearInterval(poller);
            this.pollers.delete(projectId);
        }
    }

    private static fail(projectId: string, error: string) {
        this.stopPolling(projectId);
        this.patch(projectId, {
            status: 'failed',
            phase: 'failed',
            error,
            retry: () => this.retry(projectId),
        });
    }

    /** No-op while a render for this project is active; replaces a finished one. */
    static async start(projectId: string, projectName: string, quality: ExportQuality = '1080p'): Promise<void> {
        if (this.isActive(projectId)) return;

        // Request notification permission early
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        const renderStart = performance.now();
        // Captured once: by the time the job completes the editor may hold a
        // different project (or none)
        const projectMeta = getProjectMeta();
        const slug = useProjectMetaStore.getState().meta?.slug ?? null;

        useActivityStore.getState().upsertTask({
            id: renderTaskId(projectId),
            kind: 'render',
            phase: 'saving',
            quality,
            renderStoragePath: null,
            projectId,
            projectName,
            projectSlug: slug,
            status: 'active',
            progress: null,
            error: null,
            createdAt: Date.now(),
            completedAt: null,
            retry: null,
        });

        let failPhase: FailPhase = 'saving_project';

        try {
            const userId = useUserStore.getState().userId;
            if (userId) {
                const project = useProjectStore.getState().project;
                const fullProject = { ...project, userEvents: useProjectStore.getState().userEvents };
                await CloudProjectService.saveProject(fullProject, userId);
            }

            const cloudVersion = CloudProjectService.getCloudVersion(projectId);
            if (cloudVersion === undefined) {
                this.fail(projectId, 'Project must be saved to the cloud first.');
                return;
            }

            this.patch(projectId, { phase: 'queued' });
            failPhase = 'creating_job';

            // error/message only appear on error responses
            const { data, error } = await invokeFunction<{
                jobId: string;
                status: string;
                renderStoragePath: string | null;
                error?: string;
                message?: string;
            }>('render-job-create', { projectId, cloudVersion, quality });

            if (error || data?.error) {
                const msg = data?.message || data?.error || error?.message || 'Failed to start render';
                captureError(error ?? new Error(msg), {
                    flow: 'render',
                    phase: 'creating_job',
                    projectId,
                    extra: { kind: 'cloud', http_status: httpStatus(error) },
                });
                trackRenderInCloudFailed({
                    project_id: projectId,
                    error: msg,
                    error_name: error?.name,
                    http_status: httpStatus(error),
                    phase: 'creating_job',
                    is_offline: !navigator.onLine,
                    ...projectMeta,
                });
                this.fail(projectId, msg);
                return;
            }

            const { jobId, status, renderStoragePath } = data;

            // Cache hit
            if (status === 'completed' && renderStoragePath) {
                await this.downloadFile(projectId, renderStoragePath, projectMeta);
                return;
            }

            failPhase = 'polling_status';

            this.pollers.set(projectId, setInterval(async () => {
                const { data } = await invokeFunction('render-job-get-status', { jobId });

                const job = data?.job;
                if (!job) return;

                if (job.progress !== null) {
                    this.patch(projectId, { phase: 'rendering', progress: job.progress });
                    failPhase = 'server_render';
                }

                if (job.status === 'completed') {
                    this.stopPolling(projectId);
                    trackRenderInCloudCompleted({
                        project_id: projectId,
                        render_duration_s: Math.round((performance.now() - renderStart) / 1000),
                        quality,
                        ...projectMeta,
                    });
                    // completed ⇒ the worker stored the render (path set)
                    await this.downloadFile(projectId, job.render_storage_path!, projectMeta);
                } else if (job.status === 'failed' || job.status === 'canceled') {
                    const msg = job.error || `Render ${job.status}`;
                    if (job.status === 'failed') {
                        captureError(new Error(msg), {
                            flow: 'render',
                            phase: 'server_render',
                            projectId,
                            extra: { kind: 'cloud', job_status: job.status },
                        });
                    }
                    trackRenderInCloudFailed({
                        project_id: projectId,
                        error: msg,
                        phase: 'server_render',
                        job_status: job.status,
                        is_offline: !navigator.onLine,
                        ...projectMeta,
                    });
                    this.fail(projectId, msg);
                }
            }, POLL_INTERVAL_MS));
        } catch (e: unknown) {
            const info = errorInfo(e, 'Connection failed');
            captureError(e, { flow: 'render', phase: failPhase, projectId, extra: { kind: 'cloud' } });
            trackRenderInCloudFailed({
                project_id: projectId,
                error: info.message,
                error_name: info.name,
                error_stack: info.stack,
                phase: failPhase,
                is_offline: !navigator.onLine,
                ...projectMeta,
            });
            this.fail(projectId, info.message);
        }
    }

    /**
     * Fetch the finished MP4 and hand it to the browser. Retry's path back in
     * when the render itself succeeded — hence the stored storage path.
     */
    private static async download(projectId: string): Promise<void> {
        const task = this.task(projectId);
        if (!task?.renderStoragePath) return;
        await this.downloadFile(projectId, task.renderStoragePath, getProjectMetaSafe());
    }

    /** A failed download only needs the download again; anything else re-renders. */
    static retry(projectId: string): void {
        const task = this.task(projectId);
        if (!task || task.status !== 'failed') return;
        if (task.renderStoragePath) {
            void this.download(projectId);
        } else {
            void this.start(projectId, task.projectName, task.quality);
        }
    }

    private static async downloadFile(projectId: string, storagePath: string, projectMeta: ProjectMeta): Promise<void> {
        const task = this.task(projectId);
        const projectName = task?.projectName ?? '';
        this.patch(projectId, { status: 'active', phase: 'downloading', progress: 1, error: null, renderStoragePath: storagePath });
        try {
            const { data, error } = await invokeFunction<{ signedUrls: Record<string, string>; error?: string }>(
                'storage-download-urls',
                { storagePaths: [storagePath] },
            );
            if (error || data?.error) {
                const msg = data?.error || error?.message || 'Unknown error';
                captureError(error ?? new Error(msg), {
                    flow: 'render',
                    phase: 'downloading',
                    projectId,
                    extra: { kind: 'cloud', http_status: httpStatus(error) },
                });
                trackRenderInCloudFailed({
                    project_id: projectId,
                    error: msg,
                    error_name: error?.name,
                    http_status: httpStatus(error),
                    phase: 'downloading',
                    is_offline: !navigator.onLine,
                    ...projectMeta,
                });
                this.fail(projectId, msg);
                return;
            }
            const resp = await fetch(data.signedUrls[storagePath]);
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${projectName || 'render'}.mp4`;
            a.click();
            URL.revokeObjectURL(url);

            this.patch(projectId, { status: 'completed', phase: 'completed', progress: 1, completedAt: Date.now() });

            // Browser notification
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                new Notification('Export ready', { body: `${projectName || 'Your video'} is ready` });
            }
        } catch (e: unknown) {
            const info = errorInfo(e, 'Unknown error');
            captureError(e, { flow: 'render', phase: 'downloading', projectId, extra: { kind: 'cloud' } });
            trackRenderInCloudFailed({
                project_id: projectId,
                error: info.message,
                error_name: info.name,
                error_stack: info.stack,
                phase: 'downloading',
                is_offline: !navigator.onLine,
                ...projectMeta,
            });
            this.fail(projectId, info.message);
        }
    }
}

/** Off the editor there may be no project loaded — analytics get zeros rather than a throw. */
function getProjectMetaSafe(): ProjectMeta {
    try {
        return getProjectMeta();
    } catch {
        return { video_duration_s: 0, input_resolution: '', output_resolution: '' };
    }
}
