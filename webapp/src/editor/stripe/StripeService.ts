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


            const redirectUrl = 'https://recordio.site/subscription-success';

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
                return { error };
            }



            if (!data?.url) {
                return { error: new Error('No checkout URL returned') };
            }

            // Open Stripe Checkout in new tab
            // User completes payment there and can close tab when done

            window.open(data.url, '_blank');

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
