import { invokeFunction } from '../api/client';
import { useWorkspaceStore, type WorkspaceListItem, type WorkspaceSubscription } from './useWorkspaceStore';

/**
 * Switch the active workspace: update the store, persist as default,
 * and refresh the workspace-scoped subscription so plan/billing UI reflects
 * the new workspace immediately.
 */
export async function switchWorkspace(ws: WorkspaceListItem, userId: string | null): Promise<void> {
    const { setWorkspace, setSubscription } = useWorkspaceStore.getState();
    setWorkspace(ws.id, ws.name, ws.owner_id, ws.role, ws.seats);

    void invokeFunction('workspace-set-default', { workspaceId: ws.id });

    const { data } = await invokeFunction('subscription-get', { workspaceId: ws.id });
    if (data) {
        setSubscription({
            // Wire status is Stripe's string; the store keeps its narrower union
            status: data.status as WorkspaceSubscription['status'],
            plan: data.plan ?? 'pro',
            currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : null,
            cancelAt: data.cancel_at ? new Date(data.cancel_at) : null,
            billingInterval: data.billing_interval || null,
            seats: data.seats ?? null,
            stripeCustomerId: data.stripe_customer_id ?? null,
        }, userId ?? undefined);
    } else {
        setSubscription({
            status: null, plan: 'pro', currentPeriodEnd: null,
            cancelAt: null, billingInterval: null,
            seats: null, stripeCustomerId: null,
        }, userId ?? undefined);
    }
}
