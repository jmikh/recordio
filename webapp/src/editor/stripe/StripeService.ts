import { supabase } from '../../auth/AuthManager';

export class StripeService {
    /**
     * Create a Stripe Checkout session and redirect to checkout.
     *
     * In the Mac app: opens Stripe checkout in the default browser.
     * The success/cancel URLs use the recordio:// URL scheme to redirect back.
     *
     * In the browser: opens Stripe checkout in a popup window.
     */
    static async createCheckoutSession(userId: string, userEmail: string, interval: 'monthly' | 'yearly' = 'yearly'): Promise<{ error?: Error }> {
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
                    interval,
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

            const { data, error } = await supabase.functions.invoke('stripe-portal', {
                body: {
                    returnUrl,
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
