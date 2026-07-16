import { createClient } from '@supabase/supabase-js';
import { sentryFetch } from './sentryFetch';

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
 * Shared by the supabase client and the Fastify API client
 * (src/api/client.ts) so both funnel 401s into the same sign-out path.
 */
export const authAwareFetch: typeof fetch = async (url, options) => {
    const response = await sentryFetch(url, options);
    if (
        response.status === 401 &&
        !url.toString().includes('/auth/v1/') &&
        !isHandlingUnauthorized &&
        unauthorizedHandler
    ) {
        isHandlingUnauthorized = true;
        console.warn('[Supabase] 401 received — session invalid, signing out');
        Promise.resolve()
            .then(() => unauthorizedHandler!())
            .finally(() => { isHandlingUnauthorized = false; });
    }
    return response;
};

export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: authAwareFetch } })
    : null;
