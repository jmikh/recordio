import { useEffect } from 'react';
import { useToast } from '../components/Toast';
import { maybeOpenLeaveReviewModal } from '../components/LeaveReviewModal';
import { useActivityStore, type ActivityTask } from './useActivityStore';

/**
 * Toasts for background-task transitions only — never progress (the editor
 * header's and the dashboard card's badges carry that). Mounted once in App
 * inside the ToastProvider, so a render that finishes after the user has
 * left the editor still gets its "Export ready" (and the post-export review
 * ask), and a failure gets its persistent toast with Retry.
 */
export function ActivityToasts() {
    const { addToast } = useToast();

    useEffect(() => {
        const unsubscribe = useActivityStore.subscribe((state, prev) => {
            if (state.tasks === prev.tasks) return;
            for (const task of Object.values(state.tasks)) {
                const before = prev.tasks[task.id];
                if (task === before) continue;
                announce(task, before, addToast);
            }
        });
        return unsubscribe;
    }, [addToast]);

    return null;
}

type AddToast = ReturnType<typeof useToast>['addToast'];

function announce(task: ActivityTask, before: ActivityTask | undefined, addToast: AddToast) {
    // Same id, new task (render again / retry-from-scratch replaces the row)
    const isNew = !before || before.createdAt !== task.createdAt;
    const becameCompleted = task.status === 'completed' && before?.status !== 'completed';
    const becameFailed = task.status === 'failed' && before?.status !== 'failed';

    if (task.kind === 'render') {
        if (isNew && task.status === 'active') {
            addToast({
                type: 'info',
                title: 'Rendering in the cloud',
                message: "Keep working — we'll let you know when it's ready.",
            });
            return;
        }
        if (becameCompleted) {
            addToast({ type: 'success', title: 'Export ready', message: task.projectName });
            void maybeOpenLeaveReviewModal('export_completed');
            return;
        }
        if (becameFailed) {
            addToast({
                type: 'error',
                title: 'Render failed',
                message: task.error ?? undefined,
                duration: 0,
                action: task.retry ? { label: 'Retry', onClick: task.retry } : undefined,
            });
        }
        return;
    }

    // Uploads: no toast on start — the editor header badge and the dashboard
    // card's badge already show it, with the percentage
    if (becameCompleted) {
        addToast({ type: 'success', title: 'Upload complete', message: task.projectName });
    } else if (becameFailed) {
        addToast({
            type: 'error',
            title: 'Upload failed',
            message: task.error ?? undefined,
            duration: 0,
            action: task.retry ? { label: 'Retry', onClick: task.retry } : undefined,
        });
    }
}
