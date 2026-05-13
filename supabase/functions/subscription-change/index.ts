import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
 * subscription-change
 *
 * Previews or applies a plan/seat change on the caller's workspace subscription.
 * Caller must be a workspace admin.
 *
 * Request body:
 *   { workspaceId, newPlan, newSeats, dryRun }
 *
 * dryRun = true  → returns cost preview (no side effects)
 * dryRun = false → applies change in Stripe + updates DB; webhook is the authoritative DB sync
 *
 * Proration behavior: always_invoice
 *   - Seat additions / plan upgrades: charged immediately
 *   - Seat reductions: credit applied to next invoice
 */
serve(withAuth(async (req, { supabase }) => {
    const { workspaceId, newPlan, newSeats, dryRun } = await req.json();

    if (!workspaceId)                              return errorResponse('Missing workspaceId', 400);
    if (newPlan !== 'teams')                       return errorResponse('Only upgrades to Teams are supported', 400);
    if (typeof newSeats !== 'number' || newSeats < 1) return errorResponse('newSeats must be >= 1', 400);

    // ── 1. Verify admin + fetch current subscription ─────────────────────────
    // subscription_workspace_get asserts admin role internally (SECURITY DEFINER).
    const { data: currentSub, error: subError } = await supabase
        .rpc('subscription_workspace_get', { p_workspace_id: workspaceId });

    if (subError) {
        console.error('[subscription-change] subscription_workspace_get error:', subError.message);
        return errorResponse('Unauthorized or subscription not found', 403);
    }
    if (!currentSub) return errorResponse('No subscription found for this workspace', 404);
    if (!['active', 'trialing'].includes(currentSub.status)) {
        return errorResponse('Subscription is not active', 400);
    }

    // Downgrade not supported
    if (currentSub.plan === 'teams' && newPlan === 'pro') {
        return errorResponse('Downgrade to Pro is not supported', 400);
    }


    // No-op guard
    if (currentSub.plan === 'teams' && currentSub.seats === newSeats) {
        return errorResponse('No change in seats', 400);
    }

    // ── 2. Get Stripe IDs (service role — not exposed via user-facing RPC) ────
    const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: dbSub } = await adminSupabase
        .from('subscriptions')
        .select('stripe_subscription_id, stripe_customer_id')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

    if (!dbSub?.stripe_subscription_id || !dbSub?.stripe_customer_id) {
        return errorResponse('No Stripe subscription linked to this workspace', 404);
    }

    // ── 3. Validate seat floor against current member count ───────────────────
    const { count: memberCount } = await adminSupabase
        .from('workspace_members')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);

    if (newSeats < (memberCount ?? 1)) {
        return errorResponse(
            `Cannot set fewer seats than current member count (${memberCount})`,
            400,
        );
    }

    // ── 4. Retrieve Stripe subscription to get item details ───────────────────
    const stripeSub = await stripe.subscriptions.retrieve(
        dbSub.stripe_subscription_id,
        { expand: ['items.data.price'] },
    );
    const item = stripeSub.items.data[0];
    if (!item) return errorResponse('No subscription item found on Stripe subscription', 500);

    const billingInterval = (currentSub.billing_interval ?? 'monthly') as 'monthly' | 'yearly';
    const isPlanChange    = currentSub.plan !== newPlan;
    const newPriceId      = isPlanChange ? PRICE_IDS[`${newPlan}_${billingInterval}`] : null;

    if (isPlanChange && !newPriceId) {
        return errorResponse('No price configured for the target plan + interval', 500);
    }

    // Build the subscription item update object
    const subItem: Record<string, unknown> = { id: item.id, quantity: newSeats };
    if (newPriceId) subItem.price = newPriceId;

    // ── 5a. Dry run — return cost preview ─────────────────────────────────────
    if (dryRun) {
        // retrieveUpcoming does not support billing_mode=flexible subscriptions.
        // createPreview (POST /v1/invoices/create_preview) is the correct API,
        // but it isn't in stripe-node v14. Call the endpoint directly.
        const previewBody = new URLSearchParams();
        previewBody.append('customer',     dbSub.stripe_customer_id);
        previewBody.append('subscription', dbSub.stripe_subscription_id);
        previewBody.append('subscription_details[items][0][id]',       item.id);
        previewBody.append('subscription_details[items][0][quantity]', String(newSeats));
        if (newPriceId) previewBody.append('subscription_details[items][0][price]', newPriceId);
        previewBody.append('subscription_details[proration_behavior]', 'always_invoice');

        const previewRes = await fetch('https://api.stripe.com/v1/invoices/create_preview', {
            method:  'POST',
            headers: {
                Authorization:  `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: previewBody.toString(),
        });
        const upcoming = await previewRes.json();
        if (upcoming.error) {
            console.error('[subscription-change] createPreview error:', upcoming.error.message);
            return errorResponse(upcoming.error.message, 400);
        }

        // amount_due is the net immediate charge for this proration invoice.
        // Filtering by l.proration is unreliable for flexible-billing subscriptions.
        const immediateCharge = (upcoming.amount_due ?? 0) / 100;

        // Next renewal amount — always explicitly retrieve the price by ID.
        // Relying on the expand from subscriptions.retrieve is unreliable for
        // flexible-billing subscriptions (item.price may not be a full price object).
        const currentPriceId = typeof item.price === 'string'
            ? item.price
            : (item.price as Stripe.Price).id;
        const targetPriceId  = newPriceId ?? currentPriceId;
        const targetPrice    = await stripe.prices.retrieve(targetPriceId);
        const nextRenewalAmount = (targetPrice.unit_amount ?? 0) * newSeats / 100;
        console.log('[subscription-change] price:', targetPriceId, 'unit_amount:', targetPrice.unit_amount, 'next_renewal:', nextRenewalAmount);

        console.log('[subscription-change] Preview — seats:', newSeats, 'amount_due:', upcoming.amount_due, 'next_renewal:', nextRenewalAmount, 'period_end:', stripeSub.current_period_end);
        return jsonResponse({
            immediateCharge,
            nextRenewalAmount,
            billingInterval,
            nextRenewalDate:    new Date(stripeSub.current_period_end * 1000).toISOString(),
            currency:           upcoming.currency,
        });
    }

    // ── 5b. Apply the change ──────────────────────────────────────────────────
    await stripe.subscriptions.update(dbSub.stripe_subscription_id, {
        // deno-lint-ignore no-explicit-any
        items:              [subItem as any],
        proration_behavior: 'always_invoice',
    });

    // Update DB immediately so refreshSubscription() reflects the change before webhook fires.
    // Webhook is still authoritative and will sync again when it arrives.
    await adminSupabase
        .from('subscriptions')
        .update({
            plan:       newPlan,
            seats:      newSeats,
            updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId);

    console.log('[subscription-change] Applied — plan:', newPlan, 'seats:', newSeats);
    return jsonResponse({ success: true, plan: newPlan, seats: newSeats });
}));
