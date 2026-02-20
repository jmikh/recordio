import * as Sentry from "@sentry/react";
import { browserTracingIntegration } from "@sentry/browser";

const SENTRY_DSN = "https://fde57e7672d1a32e8012e54dc499695a@o4510721001521152.ingest.us.sentry.io/4510721031995392";
const IS_PRODUCTION = import.meta.env.MODE === "production";

let initialized = false;

export function initSentry() {
    if (initialized) return;

    Sentry.init({
        dsn: SENTRY_DSN,
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

export function captureBugReport(description: string, additionalContext?: Record<string, any>) {
    Sentry.withScope((scope) => {
        scope.setLevel("info");
        scope.setTag("report.type", "user-submitted");
        scope.setExtra("userDescription", description);

        if (additionalContext) {
            Object.entries(additionalContext).forEach(([key, value]) => {
                scope.setExtra(key, value);
            });
        }

        Sentry.captureMessage(`User Bug Report: ${description}`);
    });
}

export function captureException(error: Error) {
    Sentry.captureException(error);
}

export function captureMessage(message: string) {
    Sentry.captureMessage(message);
}
