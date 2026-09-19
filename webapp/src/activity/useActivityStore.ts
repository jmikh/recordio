import { create } from 'zustand';
import type { ExportQuality } from '@shared/utils/exportQuality';

/**
 * Background tasks that outlive the page that started them — cloud renders
 * and media uploads (plans/background-activity-oneshot.md).
 *
 * The services that own the work (CloudRenderService, CloudProjectService)
 * write here; the surfaces that report it read per project: the editor
 * header's UploadStatusBadge, the dashboard card's UploadingBadge, and
 * ActivityToasts (which announces transitions and carries Retry/Download).
 * Tasks are keyed per kind + project, so a project has at most one render
 * and one upload, and starting again replaces the finished one.
 *
 * Lifecycle: active → completed or failed. Terminal tasks stay for the
 * session — they're invisible to the badges and keep the toast's actions
 * (a completed render's storage path) working.
 */

export type CloudRenderPhase = 'idle' | 'saving' | 'queued' | 'rendering' | 'downloading' | 'completed' | 'failed';
export type ActivityStatus = 'active' | 'completed' | 'failed';

interface ActivityTaskBase {
    /** `render:${projectId}` | `upload:${projectId}` */
    id: string;
    projectId: string;
    projectName: string;
    /** Where the project lives, for actions that navigate; null until known */
    projectSlug: string | null;
    status: ActivityStatus;
    /** 0..1; null = indeterminate (saving/queued, upload before the first byte) */
    progress: number | null;
    error: string | null;
    createdAt: number;
    completedAt: number | null;
    /** Set by the owning service; null when not retryable */
    retry: (() => void) | null;
}

export interface RenderTask extends ActivityTaskBase {
    kind: 'render';
    phase: Exclude<CloudRenderPhase, 'idle'>;
    quality: ExportQuality;
    /** Known once the job completes — lets the toast's Download re-fetch the file */
    renderStoragePath: string | null;
}

export interface UploadTask extends ActivityTaskBase {
    kind: 'upload';
}

export type ActivityTask = RenderTask | UploadTask;

interface ActivityStore {
    tasks: Record<string, ActivityTask>;
    upsertTask: (task: ActivityTask) => void;
    patchTask: (id: string, patch: Partial<ActivityTask>) => void;
    removeTask: (id: string) => void;
}

export const renderTaskId = (projectId: string) => `render:${projectId}`;
export const uploadTaskId = (projectId: string) => `upload:${projectId}`;

export const useActivityStore = create<ActivityStore>()((set) => ({
    tasks: {},

    upsertTask: (task) => set((s) => ({ tasks: { ...s.tasks, [task.id]: task } })),
    patchTask: (id, patch) => set((s) => {
        const existing = s.tasks[id];
        if (!existing) return s;
        return { tasks: { ...s.tasks, [id]: { ...existing, ...patch } as ActivityTask } };
    }),
    removeTask: (id) => set((s) => {
        if (!s.tasks[id]) return s;
        const tasks = { ...s.tasks };
        delete tasks[id];
        return { tasks };
    }),
}));

// ─── Selectors (pure; usable from React and from tests) ──────

type State = Pick<ActivityStore, 'tasks'>;

export const selectRenderTask = (projectId: string) => (s: State): RenderTask | undefined =>
    s.tasks[renderTaskId(projectId)] as RenderTask | undefined;

export const selectUploadTask = (projectId: string) => (s: State): UploadTask | undefined =>
    s.tasks[uploadTaskId(projectId)] as UploadTask | undefined;
