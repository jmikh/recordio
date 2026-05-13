import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
    apiVersion: '2024-11-20.acacia',
    httpClient: Stripe.createFetchHttpClient(),
});

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

// ============================================================================
// Helpers
// ============================================================================

/** Read plan from price metadata. Throws if plan_type is missing or invalid. */
function planFromSubscription(subscription: Stripe.Subscription): 'pro' | 'teams' {
    const price = subscription.items?.data?.[0]?.price;
    const planType = price?.metadata?.plan_type;
    if (planType !== 'pro' && planType !== 'teams') {
        throw new Error(`Missing or invalid plan_type metadata on price ${price?.id ?? 'unknown'}. Expected 'pro' or 'teams'.`);
    }
    return planType;
}

function periodEndToIso(value: number | string | null | undefined): string | null {
    if (!value) return null;
    const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

// ============================================================================
// Webhook Handler
// ============================================================================

serve(async (req) => {
    const signature = req.headers.get('stripe-signature');
    if (!signature) return new Response('No signature', { status: 400 });

    try {
        const body = await req.text();
        const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
        console.log('[Webhook] Event:', event.type);

        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
                await handleSubscriptionUpdate(event.data.object as Stripe.Subscription, event.created);
                break;
            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, event.created);
                break;
            default:
                console.log('[Webhook] Unhandled event type:', event.type);
        }

        return new Response(JSON.stringify({ received: true }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        const stack = error instanceof Error ? error.stack : '';
        console.error('[Webhook] Error:', msg);
        return new Response(JSON.stringify({
            error: msg,
            details: stack?.substring(0, 200),
        }), { headers: { 'Content-Type': 'application/json' }, status: 400 });
    }
});

// ============================================================================
// Checkout Completed
// ============================================================================

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const userId      = session.metadata?.userId || session.client_reference_id;
    const workspaceId = session.metadata?.workspaceId;
    const customerId  = session.customer as string;
    const subscriptionId = session.subscription as string;

    if (!userId) { console.error('[Webhook] No userId in checkout session'); return; }
    if (!workspaceId) { console.error('[Webhook] No workspaceId in checkout metadata'); return; }
    if (!subscriptionId) { console.error('[Webhook] No subscriptionId in checkout session'); return; }

    console.log('[Webhook] Checkout completed — user:', userId, 'workspace:', workspaceId);

    // Fetch authoritative subscription data from Stripe
    let plan: 'pro' | 'teams' = 'pro';
    let billingInterval: string | null = null;
    let stripeStatus = 'active';
    let stripePeriodEnd: string | null = null;
    let seats: number | null = null;

    try {
        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        const item  = stripeSub.items?.data?.[0];
        const price = item?.price;
        plan           = planFromSubscription(stripeSub);
        billingInterval = price?.recurring?.interval === 'year' ? 'yearly' : 'monthly';
        stripeStatus    = stripeSub.status;
        stripePeriodEnd = periodEndToIso(item?.current_period_end ?? stripeSub.current_period_end);
        seats           = plan === 'teams' ? (item?.quantity ?? null) : null;
    } catch (err) {
        console.error('[Webhook] Error fetching Stripe subscription:', err);
    }

    const { error } = await supabase
        .from('subscriptions')
        .upsert({
            workspace_id:           workspaceId,
            user_id:                userId,
            stripe_customer_id:     customerId,
            stripe_subscription_id: subscriptionId,
            status:                 stripeStatus,
            plan,
            billing_interval:       billingInterval,
            current_period_end:     stripePeriodEnd,
            cancel_at_period_end:   false,
            seats,
            updated_at:             new Date().toISOString(),
        }, { onConflict: 'workspace_id' });

    if (error) { console.error('[Webhook] Upsert error:', error); return; }

    await supabase.rpc('set_project_expiry', { p_user_id: userId, p_expires_at: null });
    console.log('[Webhook] Subscription upserted — plan:', plan, 'seats:', seats);
}

// ============================================================================
// Subscription Updated / Created
// ============================================================================

async function handleSubscriptionUpdate(subscription: Stripe.Subscription, eventCreated: number) {
    const customerId = subscription.customer as string;

    const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('user_id, status, workspace_id, stripe_event_at')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();

    if (!existingSub) {
        console.error('[Webhook] No subscription found for customer:', customerId);
        return;
    }

    // Discard out-of-order delivery using Stripe's event timestamp.
    const incomingAt = new Date(eventCreated * 1000);
    if (existingSub.stripe_event_at && incomingAt <= new Date(existingSub.stripe_event_at)) {
        console.warn('[Webhook] Ignoring out-of-order event — incoming:', incomingAt.toISOString(), 'stored:', existingSub.stripe_event_at);
        return;
    }

    const item  = subscription.items?.data?.[0];
    const plan  = planFromSubscription(subscription);
    const seats = plan === 'teams' ? (item?.quantity ?? null) : null;

    const newStatus = subscription.status;
    const oldStatus = existingSub.status;

    const periodEnd   = periodEndToIso(item?.current_period_end ?? subscription.current_period_end);
    const cancelAtEnd = subscription.cancel_at_period_end;

    if (!periodEnd) {
        console.error('[Webhook] Invalid period_end:', item?.current_period_end);
        throw new Error('Invalid current_period_end');
    }

    const { error } = await supabase
        .from('subscriptions')
        .update({
            status:               newStatus,
            plan,
            current_period_end:   periodEnd,
            cancel_at_period_end: cancelAtEnd,
            seats,
            stripe_event_at:      incomingAt.toISOString(),
            updated_at:           new Date().toISOString(),
        })
        .eq('stripe_customer_id', customerId);

    if (error) { console.error('[Webhook] Update error:', error); return; }

    const isNowActive = ['active', 'trialing', 'past_due'].includes(newStatus);
    const wasActive   = ['active', 'trialing', 'past_due'].includes(oldStatus);
    if (isNowActive && !wasActive) {
        await supabase.rpc('set_project_expiry', { p_user_id: existingSub.user_id, p_expires_at: null });
    } else if (!isNowActive && wasActive) {
        await supabase.rpc('set_project_expiry', {
            p_user_id:   existingSub.user_id,
            p_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        });
    }

    console.log('[Webhook] Subscription updated — plan:', plan, 'status:', newStatus, 'seats:', seats);
}

// ============================================================================
// Subscription Deleted
// ============================================================================

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, eventCreated: number) {
    const customerId = subscription.customer as string;

    const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();

    const { error } = await supabase
        .from('subscriptions')
        .update({
            status:          'canceled',
            plan:            'pro',
            seats:           null,
            stripe_event_at: new Date(eventCreated * 1000).toISOString(),
            updated_at:      new Date().toISOString(),
        })
        .eq('stripe_customer_id', customerId);

    if (error) { console.error('[Webhook] Delete error:', error); return; }

    if (existingSub) {
        await supabase.rpc('set_project_expiry', {
            p_user_id:   existingSub.user_id,
            p_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        });
    }

    console.log('[Webhook] Subscription canceled for customer:', customerId);
}
