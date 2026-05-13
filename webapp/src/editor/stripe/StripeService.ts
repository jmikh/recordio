import { supabase } from '../../auth/AuthManager';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';

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
        if (!supabase) {
            return { error: new Error('Supabase not configured') };
        }

        try {
            // Open popup IMMEDIATELY in the synchronous click handler stack
            // to prevent mobile Safari and other browsers from blocking it.
            const popup = window.open('about:blank', '_blank');

            const redirectUrl = `${window.location.origin}/?subscription-success`;
            const cancelUrl = redirectUrl;

            const { data, error } = await supabase.functions.invoke('stripe-checkout', {
                body: {
                    userId,
                    userEmail,
                    plan,
                    interval,
                    workspaceId,
                    seats,
                    successUrl: redirectUrl,
                    cancelUrl,
                },
            });

            if (error) {
                console.error('[Stripe] Error creating checkout session:', error);
                console.error('[Stripe] Error details:', JSON.stringify(error, null, 2));
                popup?.close();
                return { error };
            }

            if (!data?.url) {
                popup?.close();
                return { error: new Error('No checkout URL returned') };
            }

            if (popup) {
                popup.location.href = data.url;
            } else {
                // Fallback: redirect current page if popup was blocked
                window.location.href = data.url;
            }

            return {};
        } catch (error) {
            console.error('[Stripe] Unexpected error:', error);
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
        dryRun: boolean;
    }): Promise<{ preview?: SubscriptionChangePreview; success?: boolean; error?: Error }> {
        if (!supabase) return { error: new Error('Supabase not configured') };

        try {
            const { data, error } = await supabase.functions.invoke('subscription-change', {
                body: params,
            });

            if (error) {
                console.error('[Stripe] subscriptionChange error:', error);
                return { error: error as Error };
            }

            if (params.dryRun) return { preview: data as SubscriptionChangePreview };
            return { success: true };
        } catch (err) {
            console.error('[Stripe] subscriptionChange unexpected error:', err);
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

        try {
            const returnUrl = window.location.href;
            const { workspaceId } = useWorkspaceStore.getState();

            const { data, error } = await supabase.functions.invoke('stripe-portal', {
                body: {
                    returnUrl,
                    workspaceId,
                },
            });

            if (error) {
                console.error('[Stripe] Failed to create portal session:', error);
                return { error };
            }

            return { url: data?.url };
        } catch (error) {
            console.error('[Stripe] Unexpected error:', error);
            return { error: error as Error };
        }
    }
}
