import * as Sentry from "@sentry/react";

const SENTRY_DSN = "https://fde57e7672d1a32e8012e54dc499695a@o4510721001521152.ingest.us.sentry.io/4510721031995392";
const IS_PRODUCTION = import.meta.env.MODE === "production";

export function initSentry(context: "editor" | "popup" | "background" | "content") {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: IS_PRODUCTION ? "production" : "development",

        // Send default PII data (IP address, etc.) for better debugging
        sendDefaultPii: true,

        // Only send errors in production (set to true for testing)
        enabled: true, //IS_PRODUCTION,

        // Set release version from manifest
        release: `recordo@${chrome.runtime.getManifest().version}`,

        // Add context about which part of extension
        initialScope: {
            tags: {
                "extension.context": context,
            },
        },

        // Capture 100% of errors in dev, 10% in production
        tracesSampleRate: IS_PRODUCTION ? 0.1 : 1.0,

        // Filter sensitive data
        beforeSend(event) {
            // Remove any potentially sensitive project data
            if (event.extra && typeof event.extra === 'object' && 'projectState' in event.extra) {
                const { projectState, ...rest } = event.extra;
                event.extra = rest;
            }
            return event;
        },
    });

    console.log(`[Sentry] Initialized for ${context} context`);
}

export function captureBugReport(description: string, additionalContext?: Record<string, any>) {
    Sentry.captureMessage(`User Bug Report: ${description}`, {
        level: "info",
        tags: {
            "report.type": "user-submitted",
        },
        extra: {
            userDescription: description,
            ...additionalContext,
        },
    });
}

export { Sentry };
