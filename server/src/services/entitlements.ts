/**
 * Server-side entitlements — the single source of truth for what a
 * workspace can do (billing revamp Steps 1–3,
 * plans/workspace-billing-revamp/workspace-billing-revamp-step-3.md).
 *
 * State machine: `pro` when the workspace subscription is
 * active|past_due|trialing (past_due = full access through Stripe's
 * dunning window; trialing = Stripe-side trials, tolerated though we
 * don't create them); any OTHER subscription row (canceled, unpaid, …)
 * pins the workspace to `free` — the one-way door: a workspace that
 * has ever been pro never derives `trial` again (rows are retained on
 * cancellation, so a row's existence ⇔ ever-pro). Else `trial` while
 * workspaces.trial_ends_at is in the future, else `free`.
 *
 * canExtendTrial (Step 3) is true only when the trial ended unused
 * (trial_extension_count 0) and no subscription row exists — it gates
 * the "extend trial" link client-side; /trial-extend enforces the same
 * predicate (plus owner-only) in its UPDATE guard.
 *
 * projectCap and canInvite are computed but not yet enforced anywhere
 * (revamp Steps 4 and 6) — the payload ships complete from day 1 so
 * the client reads one stable shape.
 */
import type {
    WorkspaceEntitlements,
    WorkspaceEntitlementsState,
} from '@shared/api/entitlements';
import type { Clock, Db } from '../deps.js';

/** Active-project cap on free workspaces (exact N finalized in revamp Step 4). */
export const FREE_PROJECT_CAP = 3;

const PRO_STATUSES = new Set(['active', 'past_due', 'trialing']);

export function deriveEntitlementsState(
    subscriptionStatus: string | null,
    trialEndsAt: Date | null,
    now: Date,
): WorkspaceEntitlementsState {
    if (subscriptionStatus !== null) {
        // A row exists (status is NOT NULL in the table, so non-null
        // status ⇔ row) — the workspace is or has been pro. The one-way
        // door: never fall back to trial.
        return PRO_STATUSES.has(subscriptionStatus) ? 'pro' : 'free';
    }
    if (trialEndsAt !== null && trialEndsAt > now) return 'trial';
    return 'free';
}

export function entitlementsForState(
    state: WorkspaceEntitlementsState,
    trialEndsAt: Date | null = null,
    canExtendTrial = false,
): WorkspaceEntitlements {
    const paid = state !== 'free';
    return {
        state,
        canShare: paid,
        canTranscribe: paid,
        canBackgroundExport: paid,
        can4k: paid,
        canInvite: state === 'pro',
        projectCap: paid ? null : FREE_PROJECT_CAP,
        trialEndsAt: state === 'trial' && trialEndsAt ? trialEndsAt.toISOString() : null,
        canExtendTrial: state === 'free' && canExtendTrial,
    };
}

/**
 * Unknown or soft-deleted workspaces come back free-shaped — callers
 * do their own existence/access checks first; the gate just denies.
 */
export async function getWorkspaceEntitlements(
    db: Db,
    clock: Clock,
    workspaceId: string,
): Promise<WorkspaceEntitlements> {
    const { rows } = await db.query(
        `SELECT s.status, w.trial_ends_at, w.trial_extension_count
         FROM workspaces w
         LEFT JOIN subscriptions s ON s.workspace_id = w.id
         WHERE w.id = $1 AND w.deleted_at IS NULL`,
        [workspaceId],
    );
    const row = rows[0] as
        | {
              status: string | null;
              trial_ends_at: Date | string | null;
              trial_extension_count: number;
          }
        | undefined;
    const trialEndsAt = row?.trial_ends_at ? new Date(row.trial_ends_at) : null;
    const now = clock.now();
    const canExtendTrial =
        (row?.status ?? null) === null &&
        trialEndsAt !== null &&
        trialEndsAt <= now &&
        row?.trial_extension_count === 0;
    return entitlementsForState(
        deriveEntitlementsState(row?.status ?? null, trialEndsAt, now),
        trialEndsAt,
        canExtendTrial,
    );
}
