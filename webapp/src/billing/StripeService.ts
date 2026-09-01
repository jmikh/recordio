import { invokeFunction } from '../api/client';
import { useWorkspaceStore } from '../workspace/useWorkspaceStore';
import { captureError } from '../lib/sentry';
import { trackCheckoutSessionFailed, trackSubscriptionChangeFailed } from '../analytics';

export interface SubscriptionChangePreview {
    immediateCharge:   number;               // dollars charged today (proration)
    nextRenewalAmount: number;               // dollars per billing cycle at next renewal
    billingInterval:   'monthly' | 'yearly'; // cycle length for the renewal amount
    nextRenewalDate:   string;               // ISO date of next renewal
    currency:          string;
}

export class StripeService {
    /**
     * Create a Stripe Checkout session and redirect to checkout.
     *
     * In the Mac app: opens Stripe checkout in the default browser.
     * The success/cancel URLs use the recordio:// URL scheme to redirect back.
     *
     * In the browser: opens Stripe checkout in a popup window.
     */
    static async createCheckoutSession(userId: string, userEmail: string, interval: 'monthly' | 'yearly' = 'yearly', workspaceId: string | null = null): Promise<{ error?: Error }> {
        try {
            // Open popup IMMEDIATELY in the synchronous click handler stack
            // to prevent mobile Safari and other browsers from blocking it.
            const popup = window.open('about:blank', '_blank');

            const redirectUrl = `${window.location.origin}/workspace/settings/billing`;
            const cancelUrl = redirectUrl;

            const { data, error } = await invokeFunction<{ url: string | null }>('stripe-checkout', {
                userId,
                userEmail,
                interval,
                workspaceId,
                successUrl: redirectUrl,
                cancelUrl,
            });

            if (error) {
                captureError(error, { flow: 'billing', phase: 'checkout_session', extra: { interval } });
                trackCheckoutSessionFailed({
                    interval,
                    error: error.message,
                    error_name: error.name,
                    is_offline: !navigator.onLine,
                });
                popup?.close();
                return { error };
            }

            if (!data?.url) {
                const err = new Error('No checkout URL returned');
                captureError(err, { flow: 'billing', phase: 'checkout_session', extra: { interval, reason: 'no_url' } });
                trackCheckoutSessionFailed({
                    interval,
                    error: err.message,
                    is_offline: !navigator.onLine,
                });
                popup?.close();
                return { error: err };
            }

            if (popup) {
                popup.location.href = data.url;
            } else {
                // Fallback: redirect current page if popup was blocked
                window.location.href = data.url;
            }

            return {};
        } catch (error: any) {
            captureError(error, { flow: 'billing', phase: 'checkout_session', extra: { interval } });
            trackCheckoutSessionFailed({
                interval,
                error: error?.message || 'Unknown error',
                error_name: error?.name,
                is_offline: !navigator.onLine,
            });
            return { error: error as Error };
        }
    }

    /**
     * Preview or apply a subscription seat/interval change (single plan
     * since the billing revamp — no plan changes).
     *
     * dryRun = true  → returns preview with cost breakdown, no side effects
     * dryRun = false → applies the change; DB is updated immediately + webhook syncs
     */
    static async subscriptionChange(params: {
        workspaceId: string;
        newSeats: number;
        newInterval?: 'monthly' | 'yearly';
        dryRun: boolean;
    }): Promise<{ preview?: SubscriptionChangePreview; success?: boolean; error?: Error }> {
        try {
            const { data, error } = await invokeFunction('subscription-change', params);

            if (error) {
                if (!params.dryRun) {
                    captureError(error, { flow: 'billing', phase: 'subscription_change', workspaceId: params.workspaceId });
                    trackSubscriptionChangeFailed({
                        workspace_id: params.workspaceId,
                        new_seats: params.newSeats,
                        error: error.message,
                        error_name: error.name,
                        is_offline: !navigator.onLine,
                    });
                }
                return { error: error as Error };
            }

            if (params.dryRun) return { preview: data as SubscriptionChangePreview };
            return { success: true };
        } catch (err: any) {
            if (!params.dryRun) {
                captureError(err, { flow: 'billing', phase: 'subscription_change', workspaceId: params.workspaceId });
                trackSubscriptionChangeFailed({
                    workspace_id: params.workspaceId,
                    new_seats: params.newSeats,
                    error: err?.message || 'Unknown error',
                    error_name: err?.name,
                    is_offline: !navigator.onLine,
                });
            }
            return { error: err as Error };
        }
    }

    /**
     * Create a Customer Portal session for managing subscription.
     *
     * In the Mac app: opens portal in the default browser via navigation interception.
     * In the browser: opens portal in a new tab.
     */
    static async createPortalSession(): Promise<{ url?: string; error?: Error }> {
        const { workspaceId } = useWorkspaceStore.getState();
        try {
            const returnUrl = `${window.location.origin}/workspace/settings/billing`;

            const { data, error } = await invokeFunction<{ url: string }>('stripe-portal', {
                returnUrl,
                workspaceId,
            });

            if (error) {
                captureError(error, { flow: 'billing', phase: 'portal_session', workspaceId: workspaceId ?? undefined });
                return { error };
            }

            return { url: data?.url };
        } catch (error) {
            captureError(error, { flow: 'billing', phase: 'portal_session', workspaceId: workspaceId ?? undefined });
            return { error: error as Error };
        }
    }
}
