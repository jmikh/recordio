import { supabase } from '../auth/AuthManager';
import { useWorkspaceStore, type WorkspaceListItem } from './useWorkspaceStore';

/**
 * Switch the active workspace: update the store, persist as default,
 * and refresh the workspace-scoped subscription so plan/billing UI reflects
 * the new workspace immediately.
 */
export async function switchWorkspace(ws: WorkspaceListItem, userId: string | null): Promise<void> {
    const { setWorkspace, setSubscription } = useWorkspaceStore.getState();
    setWorkspace(ws.id, ws.name, ws.owner_id, ws.role, ws.seats);

    if (!supabase) return;

    supabase.rpc('workspace_set_default', { p_workspace_id: ws.id }).then();

    const { data } = await supabase.rpc('subscription_get', { p_workspace_id: ws.id });
    if (data) {
        setSubscription({
            status: data.status,
            plan: data.plan ?? 'pro',
            currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : null,
            cancelAtPeriodEnd: data.cancel_at_period_end ?? false,
            billingInterval: data.billing_interval || null,
            seats: data.seats ?? null,
            stripeCustomerId: data.stripe_customer_id ?? null,
        }, userId ?? undefined);
    } else {
        setSubscription({
            status: null, plan: 'pro', currentPeriodEnd: null,
            cancelAtPeriodEnd: false, billingInterval: null,
            seats: null, stripeCustomerId: null,
        }, userId ?? undefined);
    }
}
