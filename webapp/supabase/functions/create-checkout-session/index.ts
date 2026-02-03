import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
});

const PRICE_ID = Deno.env.get('STRIPE_PRICE_ID') || '';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            console.error('[Checkout] Missing authorization header');
            return new Response(
                JSON.stringify({ error: 'Unauthorized: Missing auth header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            console.error('[Checkout] User verification failed:', userError?.message);
            return new Response(
                JSON.stringify({ error: 'Unauthorized: Invalid user' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const { userId, userEmail, successUrl, cancelUrl } = await req.json();

        if (userId !== user.id) {
            console.error('[Checkout] User ID mismatch:', userId, 'vs', user.id);
            return new Response(
                JSON.stringify({ error: 'Unauthorized: User ID mismatch' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const session = await stripe.checkout.sessions.create({
            customer_email: userEmail,
            client_reference_id: userId,
            line_items: [{ price: PRICE_ID, quantity: 1 }],
            mode: 'subscription',
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: { userId },
        });

        return new Response(
            JSON.stringify({ url: session.url }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
    } catch (error) {
        console.error('[Checkout] Error:', error);

        // Return detailed error information for debugging
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorDetails = {
            error: errorMessage,
            stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
            hasStripeKey: !!Deno.env.get('STRIPE_SECRET_KEY'),
            hasPriceId: !!Deno.env.get('STRIPE_PRICE_ID'),
            priceIdValue: Deno.env.get('STRIPE_PRICE_ID') || '(not set)',
        };

        console.error('[Checkout] Error details:', errorDetails);

        return new Response(
            JSON.stringify(errorDetails),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
    }
});
