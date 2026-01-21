import { supabase } from '../auth/AuthManager';

export class StripeService {
    /**
     * Create a Stripe Checkout session and redirect to checkout
     */
    static async createCheckoutSession(userId: string, userEmail: string): Promise<{ error?: Error }> {
        if (!supabase) {
            return { error: new Error('Supabase not configured') };
        }

        try {
            console.log('[Stripe] Creating checkout session for user:', userEmail);

            // For Chrome extensions, we can't use chrome-extension:// URLs as redirect targets
            // Users will need to manually return to the extension after payment
            const redirectUrl = 'http://localhost:3000/payment-success';

            // Call Supabase Edge Function to create checkout session
            const { data, error } = await supabase.functions.invoke('create-checkout-session', {
                body: {
                    userId,
                    userEmail,
                    successUrl: redirectUrl,
                    cancelUrl: redirectUrl,
                }
            });

            if (error) {
                console.error('[Stripe] Error creating checkout session:', error);
                return { error };
            }

            if (!data?.url) {
                return { error: new Error('No checkout URL returned') };
            }

            // Open Stripe Checkout in new tab
            // User completes payment there and can close tab when done
            console.log('[Stripe] Opening checkout in new tab...');
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
                }
            });

            if (error) {
                console.error('[Stripe] Error creating portal session:', error);
                return { error };
            }

            return { url: data?.url };
        } catch (error) {
            console.error('[Stripe] Unexpected error:', error);
            return { error: error as Error };
        }
    }
}
