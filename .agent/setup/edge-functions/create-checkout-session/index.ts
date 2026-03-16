import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
});

const PRICE_ID = 'price_YOUR_PRICE_ID_HERE'; // Replace with your Stripe Price ID

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { userId, userEmail, successUrl, cancelUrl } = await req.json();

        console.log('[Checkout] Creating session for user:', userEmail);

        // Create Stripe checkout session
        const session = await stripe.checkout.sessions.create({
            customer_email: userEmail,
            client_reference_id: userId,
            line_items: [
                {
                    price: PRICE_ID,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: successUrl || `${req.headers.get('origin')}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelUrl || req.headers.get('origin'),
            metadata: {
                userId,
            },
        });

        console.log('[Checkout] Session created:', session.id);

        return new Response(
            JSON.stringify({ url: session.url }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        );
    } catch (error) {
        console.error('[Checkout] Error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            }
        );
    }
});
