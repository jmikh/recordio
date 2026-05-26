import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
});

const PRICE_IDS: Record<string, string> = {
    pro_monthly:      Deno.env.get('STRIPE_PRO_PRICE_ID_MONTHLY') || '',
    pro_yearly:       Deno.env.get('STRIPE_PRO_PRICE_ID_YEARLY') || '',
    teams_monthly: Deno.env.get('STRIPE_TEAMS_PRICE_ID_MONTHLY') || '',
    teams_yearly:  Deno.env.get('STRIPE_TEAMS_PRICE_ID_YEARLY') || '',
};

/**
 * Stripe Checkout Edge Function
 *
 * Creates a Stripe checkout session for Pro or Teams subscriptions.
 *
 * Request body:
 *   { userId, userEmail, plan, interval, workspaceId, seats?, successUrl, cancelUrl }
 *
 * - plan: 'pro' | 'teams'
 * - interval: 'monthly' | 'yearly'
 * - seats: number (Teams only, defaults to 5)
 * - workspaceId: UUID of the workspace being upgraded
 */
serve(withAuth('stripe-checkout', async (req, { user }) => {
    const { userId, userEmail, plan = 'pro', interval = 'yearly', workspaceId, seats = 5, successUrl, cancelUrl } = await req.json();

    if (userId !== user.id) {
        return errorResponse('Unauthorized: User ID mismatch', 403);
    }

    if (!workspaceId) {
        return errorResponse('Missing workspaceId', 400);
    }

    const priceKey = `${plan}_${interval}`;
    const priceId = PRICE_IDS[priceKey];

    if (!priceId) {
        console.error('[Checkout] No price ID configured for:', priceKey);
        return errorResponse('No price configured for the selected plan', 400);
    }

    const quantity = plan === 'teams' ? Math.max(1, seats) : 1;

    const session = await stripe.checkout.sessions.create({
        customer_email: userEmail,
        client_reference_id: userId,
        line_items: [{ price: priceId, quantity }],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            userId,
            workspaceId,
            plan,
            interval: interval || 'yearly',
            seats: String(quantity),
        },
    });

    return jsonResponse({ url: session.url });
}));
