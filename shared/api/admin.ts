/**
 * Client↔server contract for the admin-only impersonation routes
 * (plans/admin-user-impersonation-oneshot.md). Both routes 403 unless
 * the caller's verified JWT email is in the server's ADMIN_EMAILS
 * allowlist — the webapp's /admin page uses that 403 as its
 * "am I admin" probe.
 */
import { Type, type Static } from '@sinclair/typebox';

// ── POST /admin-user-list ────────────────────────────────────────

/**
 * One row of the impersonation picker, most-recently-active first
 * (GREATEST of last sign-in and latest project update). Capped
 * server-side (~500) — fuzzy filtering happens client-side.
 */
export interface AdminUserSummary {
    id: string;
    email: string | null;
    name: string | null;
    created_at: string;
    last_active_at: string | null;
    project_count: number;
}

/** Empty body. */
export interface AdminUserListResponse {
    users: AdminUserSummary[];
}

// ── POST /admin-impersonate ──────────────────────────────────────

export const AdminImpersonateRequestSchema = Type.Object({
    userId: Type.String({ minLength: 1 }),
});
export type AdminImpersonateRequest = Static<typeof AdminImpersonateRequestSchema>;

/**
 * `token` is a server-minted HS256 user JWT for the target
 * (sub = userId, role = 'authenticated', impersonated_by = admin id,
 * 1h expiry, no refresh). The webapp keeps it in sessionStorage and
 * prefers it over the real session token in invokeFunction.
 */
export interface AdminImpersonateResponse {
    token: string;
    /** ISO timestamp of the token's expiry. */
    expiresAt: string;
    targetUser: {
        id: string;
        email: string | null;
        name: string | null;
    };
}
