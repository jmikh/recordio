import { useState, useRef, useCallback } from 'react';
import { ExportManager, type ExportProgress, type ExportEnvironment } from '@shared/export/ExportManager';
import { browserRenderContext } from '../../utils/renderContext';
import { useMediaUrlStore } from '../../../storage/useMediaUrlStore';
import { getClickSoundBuffer, getDragSoundBuffers } from '../../audio/clickSoundPlayer';
import { LocalPreferences } from '../../../lib/localPreferences';
import { useProjectStore } from '../../stores/useProjectStore';
import { captureError } from '../../../lib/sentry';
import type { Project } from '@shared/types';
import type { ExportQuality } from '@shared/utils/exportQuality';

interface UseLocalRenderOptions {
    project: Project;
    projectName: string;
    quality: ExportQuality;
    videoDecodePreference: 'gpu' | 'cpu';
    onDecodeFallback: () => void;
}

export function useLocalRender({ project, projectName, quality, videoDecodePreference, onDecodeFallback }: UseLocalRenderOptions) {
    const [isLocalRendering, setIsLocalRendering] = useState(false);
    const [localRenderProgress, setLocalRenderProgress] = useState<ExportProgress | null>(null);
    const exportRef = useRef<ExportManager | null>(null);

    const startOrCancel = useCallback(async (): Promise<
        | { success: true; message: string }
        | { success: false; error: null }
        | {
            success: false;
            error: string;
            errorName?: string;
            errorStack?: string;
            phase: 'loading_sounds' | 'exporting' | 'downloading';
        }
    > => {
        if (isLocalRendering) {
            exportRef.current?.cancel();
            return { success: false, error: null };
        }

        setIsLocalRendering(true);
        setLocalRenderProgress(null);
        const exportManager = new ExportManager();
        exportRef.current = exportManager;

        let phase: 'loading_sounds' | 'exporting' | 'downloading' = 'loading_sounds';
        try {
            const [clickBuffer, dragBuffers] = await Promise.all([
                getClickSoundBuffer(),
                getDragSoundBuffers(),
            ]);

            // Sync persisted decode pref so FrameExtractor picks up the toggle
            LocalPreferences.setPreferSoftwareDecode(videoDecodePreference === 'cpu');

            const env: ExportEnvironment = {
                renderContext: browserRenderContext,
                videoDecodePreference,
                onDecodeFallback,
                decodePreferences: {
                    getPreferSoftwareDecode: () => LocalPreferences.getPreferSoftwareDecode(),
                    setPreferSoftwareDecode: (v) => LocalPreferences.setPreferSoftwareDecode(v),
                },
                soundEffects: {
                    click: clickBuffer,
                    dragDown: dragBuffers.down,
                    dragUp: dragBuffers.up,
                },
                mediaUrls: useMediaUrlStore.getState().urls,
            };

            // Runtime store strips userEvents from project — reconstruct full project
            const fullProject = { ...project, userEvents: useProjectStore.getState().userEvents };

            phase = 'exporting';
            const result = await exportManager.exportProject(
                fullProject,
                quality,
                (progress) => setLocalRenderProgress(progress),
                { skipDownload: false },
                env,
                projectName,
            );

            phase = 'downloading';
            const url = URL.createObjectURL(result.blob!);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${projectName || 'render'}_local.mp4`;
            a.click();
            URL.revokeObjectURL(url);

            return {
                success: true,
                message: `Decode: ${result.videoDecodeMode}, Codec: ${result.codecs.video.encoder}`,
            };
        } catch (e: any) {
            if (e?.message === 'Export cancelled') {
                return { success: false, error: null };
            }
            captureError(e, {
                flow: 'render',
                phase,
                projectId: project.id,
                extra: { kind: 'local' },
            });
            return {
                success: false,
                error: e?.message || 'Unknown error',
                errorName: e?.name,
                errorStack: typeof e?.stack === 'string' ? e.stack.split('\n').slice(0, 5).join('\n') : undefined,
                phase,
            };
        } finally {
            setIsLocalRendering(false);
            setLocalRenderProgress(null);
            exportRef.current = null;
        }
    }, [isLocalRendering, project, projectName, quality, videoDecodePreference, onDecodeFallback]);

    return { isLocalRendering, localRenderProgress, startOrCancel };
}
