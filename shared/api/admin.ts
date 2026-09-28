/**
 * Client↔server contract for the admin-only routes
 * (plans/admin-user-impersonation-oneshot.md). Every route here 403s
 * unless the caller's verified JWT email is in the server's
 * ADMIN_EMAILS allowlist.
 */
import { Type, type Static } from '@sinclair/typebox';

// ── POST /admin-status ───────────────────────────────────────────

/**
 * The webapp's "am I admin" probe: 200 for admins, 403 otherwise. The
 * /admin page renders nothing until this answers, and a 403 becomes a
 * plain 404 so the page's existence is never revealed. Empty body.
 */
export interface AdminStatusResponse {
    ok: true;
}

// ── POST /admin-growth-stats ─────────────────────────────────────

/** Rows created on one UTC day (`day` is YYYY-MM-DD). Days with zero rows are omitted. */
export interface AdminDailyCount {
    day: string;
    count: number;
}

/**
 * Empty body. Signups (auth.users) and project creations per UTC day,
 * ascending, since the first row of each. Sparse — the page fills the
 * gaps and re-buckets (day/week/month, rate/cumulative) client-side.
 * Projects count every row ever created, deleted ones included: this
 * is a creation-rate chart, not an inventory.
 */
export interface AdminGrowthStatsResponse {
    accounts: AdminDailyCount[];
    projects: AdminDailyCount[];
}

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
