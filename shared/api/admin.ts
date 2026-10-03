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

// ── POST /admin-project-list ─────────────────────────────────────

/**
 * One row of the admin's recent-projects list: a live, ready project
 * with its owner and the features its project_data carries, so an
 * admin can pick an interesting one and jump into its editor as the
 * owner. The `has_*` flags are computed server-side from the jsonb
 * (sources present, non-empty segment arrays, any blur overlay).
 */
export interface AdminProjectSummary {
    id: string;
    name: string;
    slug: string;
    owner_id: string;
    owner_email: string | null;
    owner_name: string | null;
    created_at: string;
    updated_at: string;
    /** Recording length; null when neither the column nor the timeline has it. */
    duration_ms: number | null;
    has_camera: boolean;
    has_mic: boolean;
    has_captions: boolean;
    has_zooms: boolean;
    has_spotlights: boolean;
    has_blurs: boolean;
}

/**
 * Empty body. Most-recently-updated first, capped server-side (~100).
 * Only ready, non-trashed projects — the ones an editor can open.
 */
export interface AdminProjectListResponse {
    projects: AdminProjectSummary[];
}

// ── POST /admin-subscriber-list ──────────────────────────────────

/**
 * One row of the admin's subscribers list: a workspace that has (or
 * had) a Stripe subscription, with the user who bought it. There is a
 * single plan (per-seat Pro), so the "plan" is the billing interval
 * plus seats. `status` is Stripe's verbatim ('active', 'past_due',
 * 'trialing', 'canceled', …); a scheduled cancellation is a live
 * status with `cancel_at` set.
 */
export interface AdminSubscriberSummary {
    workspace_id: string;
    workspace_name: string;
    user_id: string;
    email: string | null;
    name: string | null;
    status: string;
    billing_interval: 'monthly' | 'yearly' | null;
    seats: number;
    /** When the subscription will end if a cancellation is scheduled. */
    cancel_at: string | null;
    current_period_end: string | null;
    stripe_customer_id: string | null;
    /** First subscribed — the subscriptions row's creation (upserts keep it). */
    subscribed_at: string | null;
    /** The buyer's auth.users signup. */
    account_created_at: string | null;
}

/** Empty body. Every subscriptions row, newest subscriber first. */
export interface AdminSubscriberListResponse {
    subscribers: AdminSubscriberSummary[];
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
