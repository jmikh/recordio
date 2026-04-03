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

export function initSentry(context: "editor" | "background" | "content" | "controller" | "welcome") {
    // Isolated contexts (extension pages) can safely use global integrations
    // Content scripts must filter them to avoid conflicts with websites that use Sentry
    const isIsolatedContext = context === "editor" || context === "controller" || context === "welcome";

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

    // Safely get extension version
    let extensionVersion = 'unknown';
    try {
        extensionVersion = chrome.runtime.getManifest?.()?.version || 'unknown';
    } catch {
        // Some contexts may not have access to getManifest
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
