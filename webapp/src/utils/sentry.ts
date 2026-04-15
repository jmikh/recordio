import * as Sentry from "@sentry/react";
import { browserTracingIntegration } from "@sentry/browser";

const SENTRY_DSN = "https://fde57e7672d1a32e8012e54dc499695a@o4510721001521152.ingest.us.sentry.io/4510721031995392";
const IS_PRODUCTION = import.meta.env.MODE === "production";

let initialized = false;

export function initSentry() {
    if (initialized) return;

    Sentry.init({
        dsn: SENTRY_DSN,
        tunnel: '/sentry',
        environment: IS_PRODUCTION ? "production" : "development",
        release: `recordio-webapp@${import.meta.env.VITE_APP_VERSION ?? "dev"}`,
        tracesSampleRate: IS_PRODUCTION ? 0.1 : 1.0,
        integrations: [browserTracingIntegration()],
        sendDefaultPii: true,
        beforeSend(event) {
            // Remove any potentially sensitive project data
            if (event.extra && typeof event.extra === 'object' && 'projectState' in event.extra) {
                const { projectState, ...rest } = event.extra;
                event.extra = rest;
            }
            return event;
        },
    });

    Sentry.setTag("app", "webapp");
    initialized = true;
}

// ============================================
// Import Error Reporting
// ============================================

export interface ImportErrorContext {
    recordingId: string | null;
    phase: 'checking' | 'receiving' | 'streaming' | 'storing' | 'unknown';
    bridgeStatus?: string;
    progress?: {
        bytesReceived: number;
        totalBytes: number;
        chunksReceived: number;
        totalChunks: number;
        source: string | null;
    } | null;
    screenVideoSize?: number;
    cameraVideoSize?: number;
    micAudioSize?: number;
    /** Extra details (e.g. size mismatch info) */
    extra?: Record<string, unknown>;
}

const pageLoadTime = Date.now();

/**
 * Capture a recording-import error with rich debugging context.
 * Call from useExtensionBridge or ImportPage catch blocks.
 */
export function captureImportError(error: unknown, ctx: ImportErrorContext) {
    const err = error instanceof Error ? error : new Error(String(error));

    Sentry.withScope((scope) => {
        scope.setTag('flow', 'import');
        scope.setTag('import.phase', ctx.phase);
        if (ctx.recordingId) scope.setTag('import.recordingId', ctx.recordingId);
        if (ctx.bridgeStatus) scope.setTag('import.bridgeStatus', ctx.bridgeStatus);

        scope.setExtra('recordingId', ctx.recordingId);
        scope.setExtra('phase', ctx.phase);
        scope.setExtra('bridgeStatus', ctx.bridgeStatus ?? null);
        scope.setExtra('timeSincePageLoadMs', Date.now() - pageLoadTime);
        scope.setExtra('userAgent', navigator.userAgent);

        if (ctx.progress) {
            scope.setExtra('progress', ctx.progress);
        }
        if (ctx.screenVideoSize !== undefined) scope.setExtra('screenVideoSize', ctx.screenVideoSize);
        if (ctx.cameraVideoSize !== undefined) scope.setExtra('cameraVideoSize', ctx.cameraVideoSize);
        if (ctx.micAudioSize !== undefined) scope.setExtra('micAudioSize', ctx.micAudioSize);
        if (ctx.extra) scope.setExtra('details', ctx.extra);

        Sentry.captureException(err);
    });
}
