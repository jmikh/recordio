import { invokeFunction } from '../api/client';
import { useWorkspaceStore, type WorkspaceListItem, type WorkspaceSubscription } from './useWorkspaceStore';

/**
 * Switch the active workspace: update the store, persist as default,
 * and refresh the workspace-scoped subscription + entitlements so
 * plan/billing UI reflects the new workspace immediately.
 */
export async function switchWorkspace(ws: WorkspaceListItem, userId: string | null): Promise<void> {
    const { setWorkspace, setSubscription } = useWorkspaceStore.getState();
    setWorkspace(ws.id, ws.name, ws.owner_id, ws.role, ws.seats);

    void invokeFunction('workspace-set-default', { workspaceId: ws.id });

    const { data } = await invokeFunction('subscription-get', { workspaceId: ws.id });
    if (data) {
        const sub = data.subscription;
        setSubscription(
            sub ? {
                // Wire status is Stripe's string; the store keeps its narrower union
                status: sub.status as WorkspaceSubscription['status'],
                currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end) : null,
                cancelAt: sub.cancel_at ? new Date(sub.cancel_at) : null,
                billingInterval: sub.billing_interval || null,
                seats: sub.seats,
                stripeCustomerId: sub.stripe_customer_id ?? null,
            } : null,
            data.entitlements,
            userId ?? undefined,
        );
    }
}
