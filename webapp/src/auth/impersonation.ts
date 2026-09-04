/**
 * Admin user impersonation (plans/admin-user-impersonation-oneshot.md).
 *
 * State is sessionStorage-only — tab-scoped, gone on tab close, and the
 * admin's real Supabase session is never touched. While active,
 * invokeFunction sends the minted impersonation token instead of the
 * session token, so every server route behaves as the target user;
 * AuthManager overrides the identity store so the UI matches.
 *
 * Expiry is enforced server-side (1h TTL): the first 401 while
 * impersonating funnels into stopImpersonation() (see notifyUnauthorized)
 * instead of the admin sign-out path.
 */
import type { AdminImpersonateResponse } from '@shared/api';

const STORAGE_KEY = 'recordio-impersonation';

export interface ImpersonationState {
    token: string;
    expiresAt: string;
    target: { id: string; email: string | null; name: string | null };
}

export function getImpersonation(): ImpersonationState | null {
    let raw: string | null;
    try {
        raw = sessionStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        const state = JSON.parse(raw) as ImpersonationState;
        return state.token && state.target ? state : null;
    } catch {
        sessionStorage.removeItem(STORAGE_KEY);
        return null;
    }
}

/** Store the minted token and reboot the app as the target user. */
export function startImpersonation(minted: AdminImpersonateResponse): void {
    const state: ImpersonationState = {
        token: minted.token,
        expiresAt: minted.expiresAt,
        target: minted.targetUser,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // Full reload so AuthManager, stores, and all cached state boot as the target
    window.location.href = '/';
}

/** End impersonation — the reload restores the admin's real session. */
export function stopImpersonation(): void {
    sessionStorage.removeItem(STORAGE_KEY);
    window.location.href = '/admin';
}
