import { useCallback } from 'react';
import type { ExportQuality } from '@shared/utils/exportQuality';
import { CloudRenderService } from '../../../activity/cloudRenderService';
import { useActivityStore, selectRenderTask, type CloudRenderPhase } from '../../../activity/useActivityStore';

export type { CloudRenderPhase };

/**
 * The editor's view of the current project's cloud render. The work itself
 * runs in CloudRenderService, so it outlives this hook (and the editor).
 */
export function useCloudRender(projectId: string, projectName: string) {
    const task = useActivityStore(selectRenderTask(projectId));

    const phase: CloudRenderPhase = task?.phase ?? 'idle';
    const progress = task?.progress ?? 0;
    const isActive = task?.status === 'active';

    const startCloudRender = useCallback(
        (quality: ExportQuality = '1080p') => CloudRenderService.start(projectId, projectName, quality),
        [projectId, projectName],
    );

    return { phase, progress, isActive, startCloudRender };
}
