/**
 * Dependency ports for the app factory.
 *
 * Route handlers never import an SDK directly — every external dependency
 * enters through `buildApp(deps)` behind a port interface (src/ports/),
 * so tests can drive the full HTTP stack with in-memory fakes
 * (server/test/fakes/, `createFakeDeps()`).
 *
 * Real adapters are written alongside the first route that needs them,
 * each with one narrow integration test in the optional adapter CI job.
 */
export { type Clock, systemClock } from './ports/clock.js';
export type { Db } from './ports/db.js';
export type * from './ports/stripe.js';
export type { MuxPort } from './ports/mux.js';
export type { S3Port } from './ports/s3.js';
export type { EmailMessage, EmailPort } from './ports/email.js';
export type { RenderJobSubmission, RenderWorkerPort } from './ports/renderWorker.js';
export type * from './ports/transcription.js';
export type { SupabaseApiPort, SupabaseUser } from './ports/supabaseApi.js';

import type { Clock } from './ports/clock.js';
import type { Db } from './ports/db.js';
import type { StripePort } from './ports/stripe.js';
import type { MuxPort } from './ports/mux.js';
import type { S3Port } from './ports/s3.js';
import type { EmailPort } from './ports/email.js';
import type { RenderWorkerPort } from './ports/renderWorker.js';
import type { TranscriptionPort } from './ports/transcription.js';
import type { SupabaseApiPort } from './ports/supabaseApi.js';

export interface Deps {
    db: Db;
    clock: Clock;
    stripe: StripePort;
    mux: MuxPort;
    s3: S3Port;
    email: EmailPort;
    renderWorker: RenderWorkerPort;
    transcription: TranscriptionPort;
    supabaseApi: SupabaseApiPort;
}
