/**
 * Client↔server contract for the session/identity routes (Part 2
 * Batch 4). user-profile-get and workspace-get-default take an empty
 * body; blob responses are plain interfaces (snake_case wire shape).
 */
import { Type, type Static } from '@sinclair/typebox';
import type { WorkspaceEntitlements } from './entitlements';
import type { WorkspaceRole } from './workspaces';

/** Empty request body (user-profile-get, workspace-get-default). */
export type EmptyRequest = Record<string, never>;

// ── POST /user-profile-get ───────────────────────────────────────

/**
 * user_profile_get's blob; the whole response is null if no profile row.
 * No trial_ends_at since revamp Step 2 — the trial lives on the
 * workspace and reaches the client via entitlements.trialEndsAt.
 * has_reviewed: the user has (claimed to have) left a CWS review —
 * gates the LeaveReviewModal; set via /user-review-set.
 */
export interface UserProfile {
    name: string | null;
    has_reviewed: boolean;
}

// ── POST /user-review-set ────────────────────────────────────────

/** Empty body; idempotent (first claim wins). */
export interface UserReviewSetResponse {
    hasReviewed: true;
}

// ── POST /workspace-get-default ──────────────────────────────────

/**
 * workspace_get_default's blob — the session bootstrap. Every account
 * owns a workspace from signup (revamp Step 2), so unlike most blobs
 * this one is never null: stored default → oldest owned.
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
 * The subscription row blob; billing_interval is DB CHECK-constrained;
 * status carries Stripe's subscription statuses verbatim (unconstrained
 * — callers narrow it into their own union). Single plan since the
 * billing revamp Step 1 — no plan field, seats is always >= 1.
 */
export interface SubscriptionInfo {
    status: string;
    current_period_end: string | null;
    cancel_at: string | null;
    stripe_customer_id: string | null;
    billing_interval: 'monthly' | 'yearly' | null;
    seats: number;
}

/**
 * Members always get entitlements — a free/trial workspace is
 * `subscription: null` + real entitlements. Non-members get 403 (the
 * old null-for-non-member information hiding can't carry entitlements).
 */
export interface SubscriptionGetResponse {
    subscription: SubscriptionInfo | null;
    entitlements: WorkspaceEntitlements;
}

// ── POST /trial-extend ───────────────────────────────────────────

/**
 * The one self-serve trial extension (revamp Step 3): +7 days from the
 * extension date, owner-only, only after the trial has ended (see
 * entitlements.canExtendTrial). Ineligible → 409 { error, reason }.
 */
export const TrialExtendRequestSchema = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
});
export type TrialExtendRequest = Static<typeof TrialExtendRequestSchema>;

export interface TrialExtendResponse {
    entitlements: WorkspaceEntitlements;
}
