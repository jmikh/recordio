import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { useUserStore } from '../auth/useUserStore';

/** Returns true if the user has access to non-free features — either an active paid workspace subscription or an active free trial. */
export function useNonFreeAccess(): boolean {
    const hasActivePlan = useWorkspaceStore(s => s.hasActivePlan);
    const hasFreeTrial = useUserStore(s => s.hasFreeTrial);
    return hasActivePlan || hasFreeTrial();
}
