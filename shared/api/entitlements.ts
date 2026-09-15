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
    /**
     * Pro workspaces only. Creator/admin invites additionally need a
     * free purchased seat — a per-role check the invite route makes
     * (plans/seat-prepurchase-oneshot.md); this flag is the plan gate.
     */
    canInvite: boolean;
    /**
     * Active-project cap per user in this workspace; null = uncapped.
     * Enforced by /project-create-v2 (revamp Step 4).
     */
    projectCap: number | null;
    /**
     * Live-screenshot cap per user in this workspace; null = uncapped.
     * Separate from projectCap (screenshots are their own sub-product);
     * enforced by /screenshot-create.
     */
    screenshotCap: number | null;
    /**
     * Restore-from-trash is trial/pro; enforced by /project-restore
     * (revamp Step 4).
     */
    canRestore: boolean;
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
