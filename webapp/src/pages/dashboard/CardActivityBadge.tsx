import { useActivityStore, selectUploadTask, selectRenderTask } from '../../activity/useActivityStore';

/**
 * Replaces the duration badge on a card whose project is busy in the
 * background (plans/background-activity-oneshot.md): its recording is still
 * uploading, or a cloud export started in the editor is still running.
 *
 * `pending` says which one the card was mounted for — an upload that hasn't
 * been picked back up yet has no task to read, and must still read as
 * "Uploading" rather than as a duration it doesn't have.
 *
 * Subscribes per project, so progress ticks re-render this badge alone.
 */
export function CardActivityBadge({ projectId, pending }: { projectId: string; pending: boolean }) {
    const upload = useActivityStore(selectUploadTask(projectId));
    const render = useActivityStore(selectRenderTask(projectId));

    if (pending) {
        if (upload?.status === 'failed') return <span className="text-destructive">Upload failed</span>;
        const pct = upload?.status === 'active' && upload.progress !== null
            ? Math.round(upload.progress * 100)
            : null;
        return <span role="status">{pct === null ? 'Uploading' : `Uploading ${pct}%`}</span>;
    }

    if (render?.phase === 'downloading') return <span role="status">Downloading</span>;

    const pct = render?.phase === 'rendering' && render.progress !== null
        ? Math.round(render.progress * 100)
        : null;
    return <span role="status">{pct === null ? 'Exporting' : `Exporting ${pct}%`}</span>;
}
