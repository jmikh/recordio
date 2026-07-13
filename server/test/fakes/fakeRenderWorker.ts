import type { RenderJobSubmission, RenderWorkerPort } from '../../src/ports/renderWorker.js';

export interface FakeRenderWorker extends RenderWorkerPort {
    submissions: RenderJobSubmission[];
}

export function createFakeRenderWorker(): FakeRenderWorker {
    const fake: FakeRenderWorker = {
        submissions: [],

        async submitJob(job) {
            fake.submissions.push(job);
        },
    };
    return fake;
}
