import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
});

serve(withAuth(async (req, { supabase }) => {
    const { returnUrl, workspaceId } = await req.json();

    if (!workspaceId) return errorResponse('Missing workspaceId', 400);

    // Use the subscription_get RPC (SECURITY DEFINER) — avoids direct table
    // access and handles workspace membership checks internally.
    const { data: sub, error: subError } = await supabase
        .rpc('subscription_get', { p_workspace_id: workspaceId });

    if (subError) throw new Error('subscription_get failed', { cause: subError });
    if (!sub?.stripe_customer_id) {
        return errorResponse('No subscription found for this workspace', 404);
    }

    const session = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: returnUrl,
    });

    return jsonResponse({ url: session.url });
}));
