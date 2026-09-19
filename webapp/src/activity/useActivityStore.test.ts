import { describe, it, expect, beforeEach } from 'vitest';
import {
    useActivityStore,
    renderTaskId,
    uploadTaskId,
    selectRenderTask,
    selectUploadTask,
    type ActivityTask,
    type RenderTask,
    type UploadTask,
} from './useActivityStore';

function upload(projectId: string, over: Partial<UploadTask> = {}): UploadTask {
    return {
        id: uploadTaskId(projectId),
        kind: 'upload',
        projectId,
        projectName: `Project ${projectId}`,
        projectSlug: null,
        status: 'active',
        progress: null,
        error: null,
        createdAt: 1,
        completedAt: null,
        retry: null,
        ...over,
    };
}

function render(projectId: string, over: Partial<RenderTask> = {}): RenderTask {
    return {
        id: renderTaskId(projectId),
        kind: 'render',
        phase: 'queued',
        quality: '1080p',
        renderStoragePath: null,
        projectId,
        projectName: `Project ${projectId}`,
        projectSlug: null,
        status: 'active',
        progress: null,
        error: null,
        createdAt: 2,
        completedAt: null,
        retry: null,
        ...over,
    };
}

const store = () => useActivityStore.getState();
const tasks = (list: ActivityTask[]) => Object.fromEntries(list.map(t => [t.id, t]));

beforeEach(() => {
    useActivityStore.setState({ tasks: {} });
});

describe('useActivityStore actions', () => {
    it('upsert replaces a task with the same id (render again after completion)', () => {
        store().upsertTask(render('p1', { status: 'completed', completedAt: 10 }));
        store().upsertTask(render('p1', { createdAt: 20 }));
        expect(Object.keys(store().tasks)).toEqual([renderTaskId('p1')]);
        expect(store().tasks[renderTaskId('p1')]).toMatchObject({ status: 'active', createdAt: 20, completedAt: null });
    });

    it('patch merges into an existing task and ignores unknown ids', () => {
        store().upsertTask(upload('p1'));
        store().patchTask(uploadTaskId('p1'), { progress: 0.5 });
        store().patchTask(uploadTaskId('nope'), { progress: 1 });
        expect(store().tasks[uploadTaskId('p1')].progress).toBe(0.5);
        expect(Object.keys(store().tasks)).toHaveLength(1);
    });

    it('removeTask drops the task', () => {
        store().upsertTask(render('p1'));
        store().removeTask(renderTaskId('p1'));
        expect(store().tasks).toEqual({});
    });

    it('a project can carry one upload and one render at once', () => {
        store().upsertTask(upload('p1'));
        store().upsertTask(render('p1'));
        expect(Object.keys(store().tasks)).toHaveLength(2);
    });
});

describe('selectors', () => {
    it('resolve per project by kind', () => {
        const state = { tasks: tasks([upload('p1'), render('p1')]) };
        expect(selectUploadTask('p1')(state)?.kind).toBe('upload');
        expect(selectRenderTask('p1')(state)?.kind).toBe('render');
        expect(selectRenderTask('p2')(state)).toBeUndefined();
    });
});
