/**
 * Client↔server contract for the session/identity routes (Part 2
 * Batch 4). user-profile-get and workspace-get-default take an empty
 * body; blob responses are plain interfaces (snake_case wire shape).
 */
import { Type, type Static } from '@sinclair/typebox';
import type { WorkspaceRole } from './workspaces';

/** Empty request body (user-profile-get, workspace-get-default). */
export type EmptyRequest = Record<string, never>;

// ── POST /user-profile-get ───────────────────────────────────────

/** user_profile_get's blob; the whole response is null if no profile row. */
export interface UserProfile {
    name: string | null;
    trial_ends_at: string | null;
}

// ── POST /workspace-get-default ──────────────────────────────────

/**
 * workspace_get_default's blob — the session bootstrap. The route
 * guarantees a workspace exists (stored default → oldest owned →
 * create), so unlike most blobs this one is never null.
 */
export interface DefaultWorkspace {
    id: string;
    name: string;
    owner_id: string;
    role: WorkspaceRole;
    seats: number | null;
    created_at: string;
    updated_at: string;
}

// ── POST /subscription-get ───────────────────────────────────────

/**
 * workspaceId omitted (never null — Ajv coerces null to "" through a
 * string schema) falls back to the caller's oldest OWNED workspace,
 * SQL parity.
 */
export const SubscriptionGetRequestSchema = Type.Object({
    workspaceId: Type.Optional(Type.String({ minLength: 1 })),
});
export type SubscriptionGetRequest = Static<typeof SubscriptionGetRequestSchema>;

/**
 * subscription_get's blob; null response = no subscription (free).
 * plan/billing_interval are DB CHECK-constrained; status carries
 * Stripe's subscription statuses verbatim (unconstrained — callers
 * narrow it into their own union).
 */
export interface SubscriptionInfo {
    status: string;
    plan: 'pro' | 'teams';
    current_period_end: string | null;
    cancel_at: string | null;
    stripe_customer_id: string | null;
    billing_interval: 'monthly' | 'yearly' | null;
    seats: number | null;
}
