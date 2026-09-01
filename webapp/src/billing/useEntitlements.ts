import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import type { WorkspaceEntitlements } from '@shared/api/entitlements';

/** Until /subscription-get resolves, render the locked (free) state. */
const FREE_ENTITLEMENTS: WorkspaceEntitlements = {
    state: 'free',
    canShare: false,
    canTranscribe: false,
    canBackgroundExport: false,
    can4k: false,
    canInvite: false,
    canRestore: false,
    projectCap: null,
    trialEndsAt: null,
    // Never offer the extension before the real payload arrives
    canExtendTrial: false,
};

/**
 * Server-computed entitlements of the active workspace (billing revamp
 * Step 1). Display state only — the server enforces the same flags on
 * the gated routes.
 */
export function useEntitlements(): WorkspaceEntitlements {
    return useWorkspaceStore(s => s.entitlements) ?? FREE_ENTITLEMENTS;
}
