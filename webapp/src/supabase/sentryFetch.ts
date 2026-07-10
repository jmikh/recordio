import * as Sentry from '@sentry/react';
import { useUserStore } from '../auth/useUserStore';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

/**
 * HTTP statuses we don't want to flood Sentry with. These are expected
 * failure modes the UI handles gracefully (auth flows, RLS denials,
 * conflict resolution, rate limiting).
 */
const IGNORED_RPC_STATUSES = new Set([401, 403, 409, 429]);

function extractRpcName(url: string): string | null {
    const m = url.match(/\/rpc\/([^?]+)/);
    return m ? m[1] : null;
}

function applyContextTags(scope: Sentry.Scope, rpcName: string) {
    scope.setTag('rpc', rpcName);
    scope.setTag('flow', 'rpc');
    const userId = useUserStore.getState().userId;
    const workspaceId = useWorkspaceStore.getState().workspaceId;
    if (userId) scope.setTag('userId', userId);
    if (workspaceId) scope.setTag('workspaceId', workspaceId);
}

/**
 * Fetch interceptor that reports Supabase RPC failures to Sentry.
 *
 * - Reports non-2xx RPC responses, except statuses in IGNORED_RPC_STATUSES.
 * - Reports network errors (fetch throws) tagged with the rpcName.
 * - Tags events with rpcName, userId, workspaceId for triage.
 */
export const sentryFetch: typeof fetch = async (url, options) => {
    const urlStr = url.toString();
    const rpcName = extractRpcName(urlStr);

    let response: Response;
    try {
        response = await fetch(url, options);
    } catch (err) {
        if (rpcName) {
            Sentry.withScope((scope) => {
                applyContextTags(scope, rpcName);
                scope.setExtra('reason', 'network_error');
                Sentry.captureException(
                    err instanceof Error ? err : new Error(`RPC network error: ${rpcName}`),
                );
            });
        }
        throw err;
    }

    if (!response.ok && rpcName && !IGNORED_RPC_STATUSES.has(response.status)) {
        const body = await response.clone().json().catch(() => ({}));
        console.warn(`[Supabase] RPC failed: ${rpcName}`, { status: response.status, body });
        Sentry.withScope((scope) => {
            applyContextTags(scope, rpcName);
            scope.setExtra('status', response.status);
            scope.setExtra('body', body);
            Sentry.captureException(new Error(`RPC failed: ${rpcName} (${response.status})`));
        });
    }

    return response;
};
