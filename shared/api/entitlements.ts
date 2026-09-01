/**
 * Workspace entitlements — the server-computed capability set the
 * client renders gates from (billing revamp Step 1,
 * plans/workspace-billing-revamp/workspace-billing-revamp-step-1.md).
 *
 * Computed by server/src/services/entitlements.ts and delivered inside
 * the /subscription-get response. The client never derives capabilities
 * from subscription status; the server enforces the same flags on the
 * gated routes, so this object is display state, not access control.
 */

export type WorkspaceEntitlementsState = 'free' | 'trial' | 'pro';

export interface WorkspaceEntitlements {
    state: WorkspaceEntitlementsState;
    canShare: boolean;
    canTranscribe: boolean;
    canBackgroundExport: boolean;
    can4k: boolean;
    /** Enforcement lands in revamp Step 6 (seats & invitations). */
    canInvite: boolean;
    /**
     * Active-project cap per user in this workspace; null = uncapped.
     * Enforcement lands in revamp Step 4 (project cap).
     */
    projectCap: number | null;
    /**
     * When the workspace trial ends (ISO); non-null only while
     * state === 'trial'.
     */
    trialEndsAt: string | null;
    /**
     * True only when the trial has ended unused (extension count 0)
     * and the workspace has never been pro — gates the "extend trial"
     * link on upgrade surfaces (revamp Step 3). /trial-extend
     * re-checks server-side (owner-only on top of this predicate).
     */
    canExtendTrial: boolean;
}
