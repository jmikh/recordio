import { supabase } from '../../auth/AuthManager';
import { isRecordioMacApp } from '../../bridge/macBridge';

export class StripeService {
    /**
     * Create a Stripe Checkout session and redirect to checkout.
     *
     * In the Mac app: opens Stripe checkout in the default browser.
     * The success/cancel URLs use the recordio:// URL scheme to redirect back.
     *
     * In the browser: opens Stripe checkout in a popup window.
     */
    static async createCheckoutSession(userId: string, userEmail: string, interval: 'monthly' | 'yearly' | 'lifetime' = 'yearly'): Promise<{ error?: Error }> {
        if (!supabase) {
            return { error: new Error('Supabase not configured') };
        }

        try {
            const isMac = isRecordioMacApp();

            // In Mac app: don't open a popup (WKWebView blocks it).
            // In browser: open popup IMMEDIATELY in the synchronous click handler stack
            // to prevent mobile Safari and other browsers from blocking it.
            const popup = isMac ? null : window.open('about:blank', '_blank');

            // Use recordio:// URL scheme for Mac app, regular origin URL for browser
            const redirectUrl = isMac
                ? 'recordio://payment-success'
                : `${window.location.origin}/?subscription-success`;
            const cancelUrl = isMac
                ? 'recordio://payment-cancel'
                : redirectUrl;

            const { data, error } = await supabase.functions.invoke('create-checkout-session', {
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

            if (isMac) {
                // In Mac app: navigate WKWebView to the Stripe URL.
                // EditorWebView.swift intercepts checkout.stripe.com and opens in browser.
                window.location.href = data.url;
            } else if (popup) {
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
     * Create a Customer Portal session for managing subscription.
     *
     * In the Mac app: opens portal in the default browser via navigation interception.
     * In the browser: opens portal in a new tab.
     */
    static async createPortalSession(customerId: string): Promise<{ url?: string; error?: Error }> {
        if (!supabase) {
            return { error: new Error('Supabase not configured') };
        }

        try {
            const returnUrl = isRecordioMacApp()
                ? 'recordio://payment-success'
                : window.location.href;

            const { data, error } = await supabase.functions.invoke('create-portal-session', {
                body: {
                    customerId,
                    returnUrl,
                },
            });

            if (error) {
                console.error('[Stripe] Failed to create portal session:', error);
                return { error };
            }

            // In Mac app: navigate so EditorWebView intercepts and opens in browser
            if (isRecordioMacApp() && data?.url) {
                window.location.href = data.url;
            }

            return { url: data?.url };
        } catch (error) {
            console.error('[Stripe] Unexpected error:', error);
            return { error: error as Error };
        }
    }
}
