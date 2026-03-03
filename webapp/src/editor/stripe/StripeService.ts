import { supabase } from '../../auth/AuthManager';

export class StripeService {
    /**
     * Create a Stripe Checkout session and redirect to checkout
     */
    static async createCheckoutSession(userId: string, userEmail: string, interval: 'monthly' | 'yearly' = 'yearly'): Promise<{ error?: Error }> {
        if (!supabase) {
            return { error: new Error('Supabase not configured') };
        }

        try {
            // Open popup IMMEDIATELY in the synchronous click handler stack.
            // This prevents mobile Safari and other browsers from blocking it.
            const popup = window.open('about:blank', '_blank');

            const redirectUrl = `${window.location.origin}/?subscription-success`;

            const { data, error } = await supabase.functions.invoke('create-checkout-session', {
                body: {
                    userId,
                    userEmail,
                    interval,
                    successUrl: redirectUrl,
                    cancelUrl: redirectUrl,
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
                // Fallback: redirect current page if popup was still somehow blocked
                console.error('[Stripe] Popup was blocked despite synchronous open, falling back to redirect');
                window.location.href = data.url;
            }

            return {};
        } catch (error) {
            console.error('[Stripe] Unexpected error:', error);
            return { error: error as Error };
        }
    }

    /**
     * Create a Customer Portal session for managing subscription
     */
    static async createPortalSession(customerId: string): Promise<{ url?: string; error?: Error }> {
        if (!supabase) {
            return { error: new Error('Supabase not configured') };
        }

        try {
            const { data, error } = await supabase.functions.invoke('create-portal-session', {
                body: {
                    customerId,
                    returnUrl: window.location.href,
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
