import { useState, useRef, useCallback } from 'react';
import { supabase } from '../../../auth/AuthManager';
import { useUserStore } from '../../stores/useUserStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { CloudProjectService } from '../../../storage/cloudProjectService';

export type CloudRenderPhase = 'idle' | 'saving' | 'queued' | 'rendering' | 'downloading' | 'completed' | 'failed';

interface UseCloudRenderOptions {
    onToast: (toast: { type: 'error' | 'info' | 'success'; title: string; message?: string; duration?: number }) => void;
}

export function useCloudRender({ onToast }: UseCloudRenderOptions) {
    const [phase, setPhase] = useState<CloudRenderPhase>('idle');
    const [progress, setProgress] = useState(0);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const cleanup = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        setPhase('idle');
        setProgress(0);
    }, []);

    const downloadFile = useCallback(async (storagePath: string, projectName: string) => {
        setPhase('downloading');
        try {
            const { data, error } = await supabase!.functions.invoke('storage-download-urls', {
                body: { storagePaths: [storagePath] },
            });
            if (error || data?.error) {
                onToast({ type: 'error', title: 'Download failed', message: data?.error || error?.message });
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

            const { data, error } = await supabase!.functions.invoke('render-job-create', {
                body: { projectId, cloudVersion },
            });

            if (error || data?.error) {
                const msg = data?.message || data?.error || error?.message || 'Failed to start render';
                onToast({ type: 'error', title: 'Render failed', message: msg, duration: 0 });
                cleanup();
                return;
            }

            const { jobId, status, renderStoragePath } = data;

            // Cache hit
            if (status === 'completed' && renderStoragePath) {
                await downloadFile(renderStoragePath, projectName);
                return;
            }

            // Poll for progress
            pollRef.current = setInterval(async () => {
                const { data: job } = await supabase!
                    .rpc('render_job_get_status', { p_job_id: jobId });

                if (!job) return;

                if (job.progress !== null) {
                    setProgress(job.progress);
                    setPhase('rendering');
                }

                if (job.status === 'completed') {
                    if (pollRef.current) {
                        clearInterval(pollRef.current);
                        pollRef.current = null;
                    }
                    await downloadFile(job.render_storage_path, projectName);
                } else if (job.status === 'failed' || job.status === 'canceled') {
                    cleanup();
                    onToast({
                        type: 'error',
                        title: 'Render failed',
                        message: job.error || `Render ${job.status}`,
                        duration: 0,
                    });
                }
            }, 3000);
        } catch (e: any) {
            onToast({ type: 'error', title: 'Render error', message: e?.message || 'Connection failed', duration: 0 });
            cleanup();
        }
    }, [phase, cleanup, downloadFile, onToast]);

    const isActive = phase !== 'idle' && phase !== 'completed' && phase !== 'failed';

    return { phase, progress, isActive, startCloudRender, cleanup };
}
