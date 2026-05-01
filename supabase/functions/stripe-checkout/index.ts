import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
});

const PRICE_IDS: Record<string, string> = {
    monthly: Deno.env.get('STRIPE_PRICE_ID_MONTHLY') || '',
    yearly: Deno.env.get('STRIPE_PRICE_ID_YEARLY') || '',
};

serve(withAuth(async (req, { user }) => {
    const { userId, userEmail, interval, successUrl, cancelUrl } = await req.json();

    if (userId !== user.id) {
        console.error('[Checkout] User ID mismatch:', userId, 'vs', user.id);
        return errorResponse('Unauthorized: User ID mismatch', 403);
    }

    const priceId = PRICE_IDS[interval || 'yearly'];

    if (!priceId) {
        console.error('[Checkout] No price ID configured for interval:', interval);
        return errorResponse('No price configured for the selected plan', 400);
    }

    const session = await stripe.checkout.sessions.create({
        customer_email: userEmail,
        client_reference_id: userId,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId, interval: interval || 'yearly' },
    });

    return jsonResponse({ url: session.url });
}));
