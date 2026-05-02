/**
 * Dev-only UI for local browser rendering with GPU/CPU decode toggle.
 * Easy to delete — just remove this file and useLocalRender.ts.
 */
import { Button } from '@shared/components';
import { TbPlayerPlay } from 'react-icons/tb';
import { useProjectStore, useProjectName } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useToast } from '../Toast';
import { useLocalRender } from './useLocalRender';

export const LocalRenderControls = () => {
    const { addToast } = useToast();
    const project = useProjectStore(s => s.project);
    const projectName = useProjectName();
    const videoDecodePreference = useUIStore(s => s.videoDecodePreference);
    const setVideoDecodePreference = useUIStore(s => s.setVideoDecodePreference);

    const { isLocalRendering, localRenderProgress, startOrCancel } = useLocalRender({
        project,
        projectName,
        videoDecodePreference,
        onDecodeFallback: () => setVideoDecodePreference('cpu'),
    });

    const handleClick = async () => {
        const result = await startOrCancel();
        if (result.success) {
            addToast({ type: 'success', title: 'Local render complete', message: result.message });
        } else if (result.error) {
            addToast({ type: 'error', title: 'Local render failed', message: result.error });
        }
    };

    return (
        <div className="mt-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-muted">Decode</span>
                <div className="flex rounded-md overflow-hidden border border-border">
                    <button
                        onClick={() => setVideoDecodePreference('gpu')}
                        className={`px-2 py-0.5 text-xs font-medium border-none cursor-pointer transition-colors ${
                            videoDecodePreference === 'gpu'
                                ? 'bg-primary text-white'
                                : 'bg-transparent text-text-muted hover:text-text-main'
                        }`}
                    >
                        GPU
                    </button>
                    <button
                        onClick={() => setVideoDecodePreference('cpu')}
                        className={`px-2 py-0.5 text-xs font-medium border-none cursor-pointer transition-colors ${
                            videoDecodePreference === 'cpu'
                                ? 'bg-primary text-white'
                                : 'bg-transparent text-text-muted hover:text-text-main'
                        }`}
                    >
                        CPU
                    </button>
                </div>
            </div>
            <Button
                variant="base"
                fullWidth
                onClick={handleClick}
                className="text-sm"
            >
                {isLocalRendering ? (
                    <>
                        <div className="h-4 w-4 border-2 border-border-hover border-t-text-highlighted rounded-full animate-spin" />
                        {localRenderProgress?.phase === 'preparing'
                            ? 'Preparing...'
                            : `${Math.round((localRenderProgress?.progress ?? 0) * 100)}%`}
                    </>
                ) : (
                    <>
                        <TbPlayerPlay className="icon-sm" />
                        Local Render
                    </>
                )}
            </Button>
        </div>
    );
};
