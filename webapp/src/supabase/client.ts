import { createClient } from '@supabase/supabase-js';
import { sentryFetch } from './sentryFetch';
import { getImpersonation, stopImpersonation } from '../auth/impersonation';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Called when Supabase returns 401 on a non-auth endpoint, indicating
 * the session token is invalid/expired. Registered by AuthManager.
 */
type UnauthorizedHandler = () => void | Promise<void>;
let unauthorizedHandler: UnauthorizedHandler | null = null;
let isHandlingUnauthorized = false;

export function setUnauthorizedHandler(handler: UnauthorizedHandler) {
    unauthorizedHandler = handler;
}

/**
 * Funnel a 401 from any transport into the sign-out path. Exported for
 * the API client's XHR upload path, which can't go through fetch.
 */
export function notifyUnauthorized() {
    if (isHandlingUnauthorized) return;
    // While impersonating, a 401 means the minted token expired (1h TTL) —
    // end impersonation (the reload restores the admin's real session)
    // instead of signing the admin out. Stays latched until the reload.
    if (getImpersonation()) {
        isHandlingUnauthorized = true;
        console.warn('[Supabase] 401 while impersonating — ending impersonation');
        stopImpersonation();
        return;
    }
    if (!unauthorizedHandler) return;
    isHandlingUnauthorized = true;
    console.warn('[Supabase] 401 received — session invalid, signing out');
    Promise.resolve()
        .then(() => unauthorizedHandler!())
        .finally(() => { isHandlingUnauthorized = false; });
}

/**
 * Whether the last token refresh could talk to the auth server at all.
 *
 * auth-js splits refresh failures in two and only tells us about one of them
 * (GoTrueClient `_recoverAndRefresh`): a rejected token (400/401) removes the
 * session and emits SIGNED_OUT, but an *unreachable* server — fetch threw, or
 * 502/503/504 — is classed retryable, so the stale session is kept and **no
 * event is emitted at all**. Nothing downstream ever learns, and the app sits
 * there believing the persisted "signed in" while every call fails. We watch
 * the refresh request here to close that gap.
 */
export type RefreshOutcome = 'reachable' | 'unreachable';
type RefreshOutcomeHandler = (outcome: RefreshOutcome) => void;
let refreshOutcomeHandler: RefreshOutcomeHandler | null = null;

export function setRefreshOutcomeHandler(handler: RefreshOutcomeHandler) {
    refreshOutcomeHandler = handler;
}

/** auth-js's own retryable-status list (auth-js lib/fetch.js NETWORK_ERROR_CODES) */
const UNREACHABLE_STATUSES = [502, 503, 504];

function isRefreshRequest(url: string) {
    return url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token');
}

/**
 * Shared by the supabase client and the Fastify API client
 * (src/api/client.ts) so both funnel 401s into the same sign-out path.
 */
export const authAwareFetch: typeof fetch = async (url, options) => {
    const href = url.toString();
    const isRefresh = isRefreshRequest(href);

    let response: Response;
    try {
        response = await sentryFetch(url, options);
    } catch (err) {
        // fetch threw — no response at all, so the server is unreachable
        if (isRefresh) refreshOutcomeHandler?.('unreachable');
        throw err;
    }

    if (isRefresh) {
        // A 400/401 here means the server answered and rejected the token;
        // auth-js turns that into SIGNED_OUT on its own.
        refreshOutcomeHandler?.(
            UNREACHABLE_STATUSES.includes(response.status) ? 'unreachable' : 'reachable',
        );
    }

    if (response.status === 401 && !href.includes('/auth/v1/')) {
        notifyUnauthorized();
    }
    return response;
};

export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: authAwareFetch } })
    : null;
