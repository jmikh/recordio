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
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

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
    /** Injectable for tests — assert emitted events instead of reading stdout */
    stream?: DestinationStream;
    /** pino-pretty transport for local dev */
    pretty?: boolean;
}

/** Fixed envelope: service/env/version via base; request_id et al. come from the hooks. */
export function createLogger(opts: CreateLoggerOptions): Logger {
    const options: LoggerOptions = {
        level: opts.level ?? 'info',
        base: { service: 'recordio-server', env: opts.env, version: opts.version },
        // PII/secret backstop — naming discipline is the primary defense
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
    if (opts.pretty) {
        return pino({
            ...options,
            transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
        });
    }
    return opts.stream ? pino(options, opts.stream) : pino(options);
}
