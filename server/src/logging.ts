/**
 * Logging foundation (plan Step 0.7).
 *
 * One canonical event per request, emitted by the onResponse hook in
 * app.ts. Route handlers never log request-shaped work directly — they
 * contribute fields via `req.logCtx.set({...})` and the hook folds them
 * into the canonical event. Direct log calls are reserved for non-request
 * work (startup, cron runs, background retries).
 *
 * Naming rules (enforced in review):
 * - snake_case; units in the name (`duration_ms`, `body_size_bytes`).
 * - Domain fields namespaced: `render.job_id`, `stripe.event_type`.
 * - `http.route` is the route template (`/projects/:id`), never the raw URL.
 * - `error_type` is a stable enum, not a message string — alerts key off it.
 * - Never spread raw objects into a log; pick fields explicitly.
 * - Prefer OTEL semantic convention names where one exists.
 */
import {
    pino,
    transport as pinoTransport,
    type DestinationStream,
    type Logger,
    type LoggerOptions,
    type TransportTargetOptions,
} from 'pino';

/** Stable enum for alerting — grows as routes migrate. Never log message strings here. */
export type ErrorType =
    | 'UnhandledException'
    | 'StripeSignatureInvalid'
    | 'MuxSignatureInvalid'
    | 'RenderWorkerTimeout'
    | 'SupabaseApiUnavailable';

/**
 * Known domain fields — the typed surface handlers can contribute to the
 * canonical request event. Add fields here as routes migrate; a typo'd
 * field is a compile error.
 */
export interface DomainLogFields {
    'project.id'?: string;
    'project.slug'?: string;
    'workspace.id'?: string;
    'render.job_id'?: string;
    'mux.asset_id'?: string;
    'mux.video_status'?: string;
    'stripe.event_type'?: string;
    'stripe.plan'?: string;
    'stripe.interval'?: string;
    'stripe.dry_run'?: boolean;
    'asset.type'?: string;
    'storage.path_count'?: number;
    'storage.bytes'?: number;
    'email.template'?: 'welcome' | 'workspace-invite' | 'seat-change';
    error_type?: ErrorType;
}

/** Per-request field bag, folded into the canonical event by the onResponse hook. */
export class RequestLogContext {
    fields: DomainLogFields = {};
    set(patch: DomainLogFields): void {
        Object.assign(this.fields, patch);
    }
}

/**
 * Typed catalog of business events — the living schema. `logEvent` is the
 * only way to emit one, so a typo'd event name or field is a compile error.
 * Business events are `info`; they are real occurrences, not diagnostics.
 */
export interface LogEventCatalog {
    'render_job.completed': { 'render.job_id': string; 'project.id'?: string };
    'subscription.changed': { 'workspace.id': string; 'stripe.event_type'?: string };
    /**
     * Scheduled-job runs (Wave C) — logging IS the metrics/audit surface
     * for jobs (no ledger table, user decision): counts are read as
     * metrics in logs, and alerting keys off `job.status` (mirrors the
     * request event: one event per occurrence, outcome as a field).
     * status=success with items_failed>0 is a partial failure;
     * status=failure means the run threw (no counts available).
     * batch_full = processed hit the job's batch LIMIT (backlog signal).
     */
    'job.run':
        | {
              'job.name': string;
              'job.trigger': 'startup' | 'interval';
              'job.status': 'success';
              duration_ms: number;
              'job.items_processed': number;
              'job.items_failed': number;
              'job.batch_full': boolean;
          }
        | {
              'job.name': string;
              'job.trigger': 'startup' | 'interval';
              'job.status': 'failure';
              duration_ms: number;
          };
}

/** Structural sink — both pino Logger and FastifyBaseLogger satisfy it. */
interface LogSink {
    info(obj: object, msg?: string): void;
}

export function logEvent<K extends keyof LogEventCatalog>(
    log: LogSink,
    event: K,
    fields: LogEventCatalog[K],
): void {
    log.info({ event, ...fields }, event);
}

export interface CreateLoggerOptions {
    env: string;
    version: string;
    level?: string;
    /** Injectable for tests — bypasses transports entirely (never touches Axiom) */
    stream?: DestinationStream;
    /** pino-pretty transport for local dev */
    pretty?: boolean;
    /** Ship logs to Axiom alongside stdout (worker-thread transport) */
    axiom?: { dataset: string; token: string };
}

/** Fixed envelope: service/env/version via base; request_id et al. come from the hooks. */
export function createLogger(opts: CreateLoggerOptions): Logger {
    const level = opts.level ?? 'info';
    const options: LoggerOptions = {
        level,
        base: { service: 'recordio-server', env: opts.env, version: opts.version },
        // PII/secret backstop — naming discipline is the primary defense.
        // Redaction runs main-thread before transport serialization, so
        // Axiom only ever receives '[redacted]'.
        redact: {
            paths: [
                'authorization',
                '*.authorization',
                'req.headers.authorization',
                'token',
                '*.token',
                'email',
                '*.email',
            ],
            censor: '[redacted]',
        },
    };
    // Test sink wins over everything: an injected stream must never spawn
    // a transport worker or ship to Axiom.
    if (opts.stream) {
        return pino(options, opts.stream);
    }

    // Explicit per-target level: pino's multistream defaults each target to
    // 'info' regardless of the logger level.
    const stdoutTarget: TransportTargetOptions = opts.pretty
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' }, level }
        : { target: 'pino/file', options: { destination: 1 }, level };

    if (!opts.axiom) {
        return opts.pretty ? pino({ ...options, transport: stdoutTarget }) : pino(options);
    }

    const transport = pinoTransport({
        targets: [
            stdoutTarget,
            {
                target: '@axiomhq/pino',
                options: { dataset: opts.axiom.dataset, token: opts.axiom.token },
                level,
            },
        ],
    });
    // An unlistened ThreadStream 'error' would take the process down via
    // uncaughtException; the logger's own sink is this stream, so report
    // straight to stderr instead.
    transport.on('error', (err: Error) => {
        // eslint-disable-next-line no-console
        console.error('pino transport error:', err);
    });
    return pino(options, transport);
}
