import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/**
 * Stripe Add Seats Edge Function
 *
 * Adds seats to an existing Teams subscription.
 * Caller must be a workspace admin.
 *
 * Request body: { workspaceId, additionalSeats }
 * Response:     { seats } — new total seat count
 */
serve(withAuth('stripe-add-seats', async (req, { user }) => {
    const { workspaceId, additionalSeats } = await req.json();

    if (!workspaceId) return errorResponse('Missing workspaceId', 400);
    if (!additionalSeats || additionalSeats < 1) return errorResponse('additionalSeats must be >= 1', 400);

    const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verify caller is admin of this workspace
    const { data: member } = await adminSupabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (!member || member.role !== 'admin') {
        return errorResponse('Access denied — workspace admin required', 403);
    }

    // Fetch current subscription
    const { data: sub } = await adminSupabase
        .from('subscriptions')
        .select('stripe_subscription_id, plan, seats')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

    if (!sub?.stripe_subscription_id) return errorResponse('No active subscription found', 404);
    if (sub.plan !== 'teams') return errorResponse('Seat management is only available on the Teams plan', 400);

    const currentSeats = sub.seats ?? 1;
    const newSeats = currentSeats + additionalSeats;

    // Fetch the subscription from Stripe to get the item ID
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const itemId = stripeSub.items?.data?.[0]?.id;

    if (!itemId) return errorResponse('Could not find subscription item', 500);

    // Update quantity on Stripe — triggers proration automatically
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
        items: [{ id: itemId, quantity: newSeats }],
    });

    // Update seats in DB immediately (webhook will also fire and confirm)
    await adminSupabase
        .from('subscriptions')
        .update({ seats: newSeats, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId);

    console.log(`[stripe-add-seats] workspace ${workspaceId}: ${currentSeats} → ${newSeats} seats`);
    return jsonResponse({ seats: newSeats });
}));
