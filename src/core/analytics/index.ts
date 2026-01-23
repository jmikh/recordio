/**
 * @fileoverview Google Analytics 4 Integration via Measurement Protocol
 * 
 * Chrome Extensions (Manifest V3) cannot load remote scripts, so we use
 * the GA4 Measurement Protocol to send events directly via HTTP requests.
 * 
 * @see https://developer.chrome.com/docs/extensions/how-to/integrate/google-analytics-4
 */

// GA4 Configuration
const GA_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const MEASUREMENT_ID = 'G-F267K7F3N5'; // Extension-specific stream
const API_SECRET = 'NMyI0_6XTQ2wlkWaste5rg';

const DEFAULT_ENGAGEMENT_TIME_MSEC = 100;
const SESSION_EXPIRATION_IN_MIN = 30;

/**
 * Get or create a persistent client ID for this installation.
 * Stored in chrome.storage.local to persist across browser restarts.
 */
async function getOrCreateClientId(): Promise<string> {
    const result = await chrome.storage.local.get('ga_clientId') as { ga_clientId?: string };
    let clientId = result.ga_clientId;

    if (!clientId) {
        // Generate a unique client ID in the format <random>.<timestamp>
        const randomPart = Math.random().toString(36).substring(2, 12);
        const timestampPart = Math.floor(Date.now() / 1000);
        clientId = `${randomPart}.${timestampPart}`;
        await chrome.storage.local.set({ ga_clientId: clientId });
    }

    return clientId;
}

interface SessionData {
    session_id: string;
    timestamp: number;
}

/**
 * Get or create a session ID with 30-minute expiration.
 * Stored in chrome.storage.session to persist during browser session.
 */
async function getOrCreateSessionId(): Promise<string> {
    const result = await chrome.storage.session.get('ga_sessionData') as { ga_sessionData?: SessionData };
    let sessionData = result.ga_sessionData;
    const currentTimeMs = Date.now();

    if (sessionData && sessionData.timestamp) {
        const durationInMin = (currentTimeMs - sessionData.timestamp) / 60000;

        if (durationInMin > SESSION_EXPIRATION_IN_MIN) {
            // Session expired, create new one
            sessionData = undefined;
        } else {
            // Update timestamp to keep session alive
            sessionData.timestamp = currentTimeMs;
            await chrome.storage.session.set({ ga_sessionData: sessionData });
        }
    }

    if (!sessionData) {
        // Create new session
        sessionData = {
            session_id: currentTimeMs.toString(),
            timestamp: currentTimeMs,
        };
        await chrome.storage.session.set({ ga_sessionData: sessionData });
    }

    return sessionData.session_id;
}

/**
 * Core event tracking function.
 * Sends an event to GA4 via the Measurement Protocol.
 */
async function trackEvent(
    eventName: string,
    eventParams: Record<string, any> = {}
): Promise<void> {
    try {
        // Ensure Chrome extension APIs are available
        if (typeof chrome === 'undefined' || !chrome.storage?.local || !chrome.storage?.session) {
            console.warn('[Analytics] Chrome storage APIs not available');
            return;
        }

        const clientId = await getOrCreateClientId();
        const sessionId = await getOrCreateSessionId();

        const payload = {
            client_id: clientId,
            events: [
                {
                    name: eventName,
                    params: {
                        session_id: sessionId,
                        engagement_time_msec: DEFAULT_ENGAGEMENT_TIME_MSEC,
                        ...eventParams,
                    },
                },
            ],
        };

        const response = await fetch(
            `${GA_ENDPOINT}?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
            {
                method: 'POST',
                body: JSON.stringify(payload),
            }
        );

        console.log(`[Analytics] Tracked event: ${eventName}`, eventParams, `(status: ${response.status})`);

        if (!response.ok) {
            const text = await response.text();
            console.warn('[Analytics] GA response error:', response.status, text);
        }
    } catch (error) {
        // Silently fail - analytics should never break the app
        console.warn('[Analytics] Failed to track event:', error);
    }
}

// ============================================================================
// Public API - Specific Event Tracking Functions
// ============================================================================

export interface RecordingCompletedParams {
    mode: 'tab' | 'window' | 'screen';
    duration_seconds: number;
    is_authenticated: boolean;
    is_pro: boolean;
}

/**
 * Track when a recording is completed.
 */
export async function trackRecordingCompleted(params: RecordingCompletedParams): Promise<void> {
    await trackEvent('recording_completed', params);
}

export interface ExportCompletedParams {
    quality: '360p' | '720p' | '1080p' | '4K';
    duration_seconds: number;
    auto_zoom: boolean;
    is_authenticated: boolean;
    is_pro: boolean;
}

/**
 * Track when a video export is completed.
 */
export async function trackExportCompleted(params: ExportCompletedParams): Promise<void> {
    await trackEvent('export_completed', params);
}

export interface CaptionsGeneratedParams {
    segment_count: number;
    is_authenticated: boolean;
    is_pro: boolean;
}

/**
 * Track when captions are generated.
 */
export async function trackCaptionsGenerated(params: CaptionsGeneratedParams): Promise<void> {
    await trackEvent('captions_generated', params);
}

export type PageType = 'editor' | 'popup';

/**
 * Track a page view in the extension.
 * Note: page_location is masked to just the page type for privacy.
 */
export async function trackPageView(pageType: PageType): Promise<void> {
    await trackEvent('page_view', {
        page_title: `Recordio ${pageType.charAt(0).toUpperCase() + pageType.slice(1)}`,
        page_location: `chrome-extension://recordio/${pageType}`,
    });
}
