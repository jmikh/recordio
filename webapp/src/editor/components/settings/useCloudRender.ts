import { useState, useRef, useCallback } from 'react';
import { supabase } from '../../../auth/AuthManager';
import { useUserStore } from '../../stores/useUserStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { CloudProjectService } from '../../../storage/cloudProjectService';
import { trackRenderInCloudCompleted, trackRenderInCloudFailed } from '../../../core/analytics';
import { captureError } from '../../../utils/sentry';

export type CloudRenderPhase = 'idle' | 'saving' | 'queued' | 'rendering' | 'downloading' | 'completed' | 'failed';

interface UseCloudRenderOptions {
    onToast: (toast: { type: 'error' | 'info' | 'success'; title: string; message?: string; duration?: number }) => void;
}

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

export function useCloudRender({ onToast }: UseCloudRenderOptions) {
    const [phase, setPhase] = useState<CloudRenderPhase>('idle');
    const [progress, setProgress] = useState(0);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const renderStartRef = useRef(0);

    const cleanup = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        setPhase('idle');
        setProgress(0);
    }, []);

    const downloadFile = useCallback(async (
        storagePath: string,
        projectName: string,
        projectId: string,
        projectMeta: ProjectMeta,
    ) => {
        setPhase('downloading');
        try {
            const { data, error } = await supabase!.functions.invoke('storage-download-urls', {
                body: { storagePaths: [storagePath] },
            });
            if (error || data?.error) {
                const msg = data?.error || error?.message || 'Unknown error';
                captureError(error ?? new Error(msg), {
                    flow: 'render',
                    phase: 'downloading',
                    projectId,
                    extra: { kind: 'cloud', http_status: (error as any)?.context?.status },
                });
                trackRenderInCloudFailed({
                    project_id: projectId,
                    error: msg,
                    error_name: error?.name,
                    http_status: (error as any)?.context?.status,
                    phase: 'downloading',
                    is_offline: !navigator.onLine,
                    ...projectMeta,
                });
                onToast({ type: 'error', title: 'Download failed', message: msg });
                setPhase('failed');
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
            setPhase('completed');

            // Browser notification
            if (Notification.permission === 'granted') {
                new Notification('Export ready', { body: `${projectName || 'Your video'} is ready` });
            }
            onToast({ type: 'success', title: 'Download complete' });

            // Reset to idle after brief completed state
            setTimeout(() => {
                setPhase('idle');
                setProgress(0);
            }, 1500);
        } catch (e: any) {
            captureError(e, { flow: 'render', phase: 'downloading', projectId, extra: { kind: 'cloud' } });
            trackRenderInCloudFailed({
                project_id: projectId,
                error: e?.message || 'Unknown error',
                error_name: e?.name,
                error_stack: typeof e?.stack === 'string' ? e.stack.split('\n').slice(0, 5).join('\n') : undefined,
                phase: 'downloading',
                is_offline: !navigator.onLine,
                ...projectMeta,
            });
            onToast({ type: 'error', title: 'Download failed', message: e?.message || 'Unknown error' });
            setPhase('failed');
        }
    }, [onToast]);

    const startCloudRender = useCallback(async (projectId: string, projectName: string) => {
        if (phase !== 'idle' && phase !== 'failed') return;

        // Request notification permission early
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }

        setPhase('saving');
        setProgress(0);
        renderStartRef.current = performance.now();

        const projectMeta = getProjectMeta();
        let failPhase: 'saving_project' | 'creating_job' | 'polling_status' | 'server_render' | 'downloading' = 'saving_project';

        try {
            const userId = useUserStore.getState().userId;
            if (userId) {
                const project = useProjectStore.getState().project;
                const fullProject = { ...project, userEvents: useProjectStore.getState().userEvents };
                await CloudProjectService.saveProject(fullProject, userId);
            }

            const cloudVersion = CloudProjectService.getCloudVersion(projectId);
            if (cloudVersion === undefined) {
                onToast({ type: 'error', title: 'Download failed', message: 'Project must be saved to the cloud first.' });
                cleanup();
                return;
            }

            setPhase('queued');
            failPhase = 'creating_job';

            const { data, error } = await supabase!.functions.invoke('render-job-create', {
                body: { projectId, cloudVersion },
            });

            if (error || data?.error) {
                const msg = data?.message || data?.error || error?.message || 'Failed to start render';
                captureError(error ?? new Error(msg), {
                    flow: 'render',
                    phase: 'creating_job',
                    projectId,
                    extra: { kind: 'cloud', http_status: (error as any)?.context?.status },
                });
                trackRenderInCloudFailed({
                    project_id: projectId,
                    error: msg,
                    error_name: error?.name,
                    http_status: (error as any)?.context?.status,
                    phase: 'creating_job',
                    is_offline: !navigator.onLine,
                    ...projectMeta,
                });
                onToast({ type: 'error', title: 'Render failed', message: msg, duration: 0 });
                cleanup();
                return;
            }

            const { jobId, status, renderStoragePath } = data;

            // Cache hit
            if (status === 'completed' && renderStoragePath) {
                await downloadFile(renderStoragePath, projectName, projectId, projectMeta);
                return;
            }

            failPhase = 'polling_status';

            // Poll for progress
            pollRef.current = setInterval(async () => {
                const { data: job } = await supabase!
                    .rpc('render_job_get_status', { p_job_id: jobId });

                if (!job) return;

                if (job.progress !== null) {
                    setProgress(job.progress);
                    setPhase('rendering');
                    failPhase = 'server_render';
                }

                if (job.status === 'completed') {
                    if (pollRef.current) {
                        clearInterval(pollRef.current);
                        pollRef.current = null;
                    }
                    trackRenderInCloudCompleted({
                        project_id: projectId,
                        render_duration_s: Math.round((performance.now() - renderStartRef.current) / 1000),
                        ...getProjectMeta(),
                    });
                    await downloadFile(job.render_storage_path, projectName, projectId, projectMeta);
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
                    cleanup();
                    onToast({
                        type: 'error',
                        title: 'Render failed',
                        message: msg,
                        duration: 0,
                    });
                }
            }, 3000);
        } catch (e: any) {
            captureError(e, { flow: 'render', phase: failPhase, projectId, extra: { kind: 'cloud' } });
            trackRenderInCloudFailed({
                project_id: projectId,
                error: e?.message || 'Connection failed',
                error_name: e?.name,
                error_stack: typeof e?.stack === 'string' ? e.stack.split('\n').slice(0, 5).join('\n') : undefined,
                phase: failPhase,
                is_offline: !navigator.onLine,
                ...projectMeta,
            });
            onToast({ type: 'error', title: 'Render error', message: e?.message || 'Connection failed', duration: 0 });
            cleanup();
        }
    }, [phase, cleanup, downloadFile, onToast]);

    const isActive = phase !== 'idle' && phase !== 'completed' && phase !== 'failed';

    return { phase, progress, isActive, startCloudRender, cleanup };
}
