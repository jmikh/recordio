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
 * Shared by the supabase client and the Fastify API client
 * (src/api/client.ts) so both funnel 401s into the same sign-out path.
 */
export const authAwareFetch: typeof fetch = async (url, options) => {
    const response = await sentryFetch(url, options);
    if (response.status === 401 && !url.toString().includes('/auth/v1/')) {
        notifyUnauthorized();
    }
    return response;
};

export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: authAwareFetch } })
    : null;
