import { supabase } from '../auth/AuthManager';
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
    static async createCheckoutSession(userId: string, userEmail: string, interval: 'monthly' | 'yearly' = 'yearly', plan: 'pro' | 'teams' = 'pro', workspaceId: string | null = null, seats = 5): Promise<{ error?: Error }> {
        try {
            // Open popup IMMEDIATELY in the synchronous click handler stack
            // to prevent mobile Safari and other browsers from blocking it.
            const popup = window.open('about:blank', '_blank');

            const redirectUrl = `${window.location.origin}/workspace/settings/billing`;
            const cancelUrl = redirectUrl;

            const { data, error } = await invokeFunction<{ url: string | null }>('stripe-checkout', {
                userId,
                userEmail,
                plan,
                interval,
                workspaceId,
                seats,
                successUrl: redirectUrl,
                cancelUrl,
            });

            if (error) {
                captureError(error, { flow: 'billing', phase: 'checkout_session', extra: { plan, interval } });
                trackCheckoutSessionFailed({
                    plan, interval,
                    error: error.message,
                    error_name: error.name,
                    is_offline: !navigator.onLine,
                });
                popup?.close();
                return { error };
            }

            if (!data?.url) {
                const err = new Error('No checkout URL returned');
                captureError(err, { flow: 'billing', phase: 'checkout_session', extra: { plan, interval, reason: 'no_url' } });
                trackCheckoutSessionFailed({
                    plan, interval,
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
            captureError(error, { flow: 'billing', phase: 'checkout_session', extra: { plan, interval } });
            trackCheckoutSessionFailed({
                plan, interval,
                error: error?.message || 'Unknown error',
                error_name: error?.name,
                is_offline: !navigator.onLine,
            });
            return { error: error as Error };
        }
    }

    /**
     * Preview or apply a subscription plan/seat change.
     *
     * dryRun = true  → returns preview with cost breakdown, no side effects
     * dryRun = false → applies the change; DB is updated immediately + webhook syncs
     */
    static async subscriptionChange(params: {
        workspaceId: string;
        newPlan: 'teams';
        newSeats: number;
        newInterval?: 'monthly' | 'yearly';
        dryRun: boolean;
    }): Promise<{ preview?: SubscriptionChangePreview; success?: boolean; error?: Error }> {
        if (!supabase) return { error: new Error('Supabase not configured') };

        try {
            const { data, error } = await supabase.functions.invoke('subscription-change', {
                body: params,
            });

            if (error) {
                if (!params.dryRun) {
                    captureError(error, { flow: 'billing', phase: 'subscription_change', workspaceId: params.workspaceId });
                    trackSubscriptionChangeFailed({
                        workspace_id: params.workspaceId,
                        new_plan: params.newPlan,
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
                    new_plan: params.newPlan,
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
        if (!supabase) {
            return { error: new Error('Supabase not configured') };
        }

        const { workspaceId } = useWorkspaceStore.getState();
        try {
            const returnUrl = `${window.location.origin}/workspace/settings/billing`;

            const { data, error } = await supabase.functions.invoke('stripe-portal', {
                body: {
                    returnUrl,
                    workspaceId,
                },
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
