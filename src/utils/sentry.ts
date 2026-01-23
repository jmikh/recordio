import {
    BrowserClient,
    defaultStackParser,
    getDefaultIntegrations,
    makeFetchTransport,
    Scope,
} from "@sentry/browser";

const SENTRY_DSN = "https://fde57e7672d1a32e8012e54dc499695a@o4510721001521152.ingest.us.sentry.io/4510721031995392";
const IS_PRODUCTION = import.meta.env.MODE === "production";

// Global scope instance for capturing errors
let sentryScope: Scope | null = null;

export function initSentry(context: "editor" | "popup" | "background" | "content" | "controller" | "offscreen") {
    // Isolated contexts (extension pages) can safely use global integrations
    // Content scripts must filter them to avoid conflicts with websites that use Sentry
    const isIsolatedContext = context === "editor" || context === "popup" || context === "controller" || context === "offscreen";

    const integrations = getDefaultIntegrations({}).filter(
        (defaultIntegration) => {
            // Always filter BrowserApiErrors to avoid monkey-patching browser APIs
            if (defaultIntegration.name === "BrowserApiErrors") {
                return false;
            }
            // Only filter GlobalHandlers and Breadcrumbs for non-isolated contexts
            if (!isIsolatedContext && ["Breadcrumbs", "GlobalHandlers"].includes(defaultIntegration.name)) {
                return false;
            }
            return true;
        },
    );

    // Safely get extension version (offscreen documents have limited chrome API access)
    let extensionVersion = 'unknown';
    try {
        extensionVersion = chrome.runtime.getManifest?.()?.version || 'unknown';
    } catch {
        // Offscreen documents may not have access to getManifest
    }

    const client = new BrowserClient({
        dsn: SENTRY_DSN,
        transport: makeFetchTransport,
        stackParser: defaultStackParser,
        integrations: integrations,
        environment: IS_PRODUCTION ? "production" : "development",
        sendDefaultPii: true,
        enabled: true,
        release: `recordio@${extensionVersion}`,
        tracesSampleRate: IS_PRODUCTION ? 0.1 : 1.0,
        beforeSend(event) {
            // Remove any potentially sensitive project data
            if (event.extra && typeof event.extra === 'object' && 'projectState' in event.extra) {
                const { projectState, ...rest } = event.extra;
                event.extra = rest;
            }
            return event;
        },
    });

    sentryScope = new Scope();
    sentryScope.setClient(client);
    sentryScope.setTag("extension.context", context);

    client.init(); // Must be called after setting client on scope

    console.log(`[Sentry] Initialized for ${context} context (browser extension mode)`);
}

export function captureBugReport(description: string, additionalContext?: Record<string, any>) {
    if (!sentryScope) {
        console.error('[Sentry] Cannot capture bug report: Sentry not initialized');
        return;
    }

    // Clone the scope to add temporary context without polluting the main scope
    const reportScope = sentryScope.clone();
    reportScope.setLevel("info");
    reportScope.setTag("report.type", "user-submitted");
    reportScope.setExtra("userDescription", description);

    if (additionalContext) {
        Object.entries(additionalContext).forEach(([key, value]) => {
            reportScope.setExtra(key, value);
        });
    }

    reportScope.captureMessage(`User Bug Report: ${description}`);
}

// Export helper functions that use our scope
export function captureException(error: Error) {
    if (!sentryScope) {
        console.error('[Sentry] Cannot capture exception: Sentry not initialized', error);
        return;
    }
    sentryScope.captureException(error);
}

export function captureMessage(message: string) {
    if (!sentryScope) {
        console.error('[Sentry] Cannot capture message: Sentry not initialized');
        return;
    }
    sentryScope.captureMessage(message);
}
