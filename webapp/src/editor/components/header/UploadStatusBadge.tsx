import { StatusBadge, Tooltip } from '@shared/components';
import { useActivityStore, selectUploadTask } from '../../../activity/useActivityStore';

/**
 * "Uploading NN%" beside the project name while this project's recording
 * is still going to the cloud; "Upload failed" when it stopped (Retry is on
 * the persistent failure toast). Nothing once the upload is done.
 */
export function UploadStatusBadge({ projectId }: { projectId: string }) {
    const task = useActivityStore(selectUploadTask(projectId));
    if (!task || task.status === 'completed') return null;

    if (task.status === 'failed') {
        return (
            <Tooltip text={task.error ?? 'Upload failed'}>
                <span className="flex items-center">
                    <StatusBadge variant="secondary">Upload failed</StatusBadge>
                </span>
            </Tooltip>
        );
    }

    const pct = task.progress === null ? null : Math.round(task.progress * 100);
    return (
        <StatusBadge variant="primary">
            {pct === null ? 'Uploading…' : `Uploading ${pct}%`}
        </StatusBadge>
    );
}
