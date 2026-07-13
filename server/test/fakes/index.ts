/**
 * In-memory fakes — the default deps in every unit test.
 * End-to-end tests override `db` with a pool pointed at the local
 * `supabase start` Postgres; the database itself is never faked.
 */
import type { Db, Deps } from '../../src/deps.js';
import { createFakeClock, type FakeClock } from './fakeClock.js';
import { createFakeStripe, type FakeStripe } from './fakeStripe.js';
import { createFakeMux, type FakeMux } from './fakeMux.js';
import { createFakeS3, type FakeS3 } from './fakeS3.js';
import { createFakeEmail, type FakeEmail } from './fakeEmail.js';
import { createFakeRenderWorker, type FakeRenderWorker } from './fakeRenderWorker.js';
import { createFakeTranscription, type FakeTranscription } from './fakeTranscription.js';
import { createFakeSupabaseApi, type FakeSupabaseApi } from './fakeSupabaseApi.js';

export { FAKE_STRIPE_SIGNATURE } from './fakeStripe.js';
export { FAKE_MUX_SIGNATURE } from './fakeMux.js';
export { createFakeClock, createFakeStripe, createFakeMux, createFakeS3, createFakeEmail, createFakeRenderWorker, createFakeTranscription, createFakeSupabaseApi };

/** Default db in unit tests: any query is a bug — use a real pool for e2e. */
export function createThrowingDb(): Db {
    return {
        query: async (text) => {
            throw new Error(`Unexpected db query in a unit test: ${text}`);
        },
    };
}

export interface FakeDeps extends Deps {
    clock: FakeClock;
    stripe: FakeStripe;
    mux: FakeMux;
    s3: FakeS3;
    email: FakeEmail;
    renderWorker: FakeRenderWorker;
    transcription: FakeTranscription;
    supabaseApi: FakeSupabaseApi;
}

export function createFakeDeps(overrides: Partial<Deps> = {}): FakeDeps {
    return {
        db: createThrowingDb(),
        clock: createFakeClock(),
        stripe: createFakeStripe(),
        mux: createFakeMux(),
        s3: createFakeS3(),
        email: createFakeEmail(),
        renderWorker: createFakeRenderWorker(),
        transcription: createFakeTranscription(),
        supabaseApi: createFakeSupabaseApi(),
        ...overrides,
    } as FakeDeps;
}
