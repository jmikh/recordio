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
// Webhook Handler
// ============================================================================

serve(async (req) => {
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
        return new Response('No signature', { status: 400 });
    }

    try {
        const body = await req.text();

        console.log('[Webhook] Received webhook, signature present:', !!signature);
        console.log('[Webhook] Webhook secret configured:', !!webhookSecret);

        const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

        console.log('[Webhook] Event received:', event.type);

        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                await handleCheckoutCompleted(session);
                break;
            }
            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const subscription = event.data.object as Stripe.Subscription;
                await handleSubscriptionUpdate(subscription);
                break;
            }
            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription;
                await handleSubscriptionDeleted(subscription);
                break;
            }
            default:
                console.log('[Webhook] Unhandled event type:', event.type);
        }

        return new Response(JSON.stringify({ received: true }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : '';

        console.error('[Webhook] Error:', error);
        console.error('[Webhook] Error message:', errorMessage);
        console.error('[Webhook] Error stack:', errorStack);

        // Return detailed error in response so it shows in Stripe logs
        return new Response(JSON.stringify({
            error: errorMessage,
            details: errorStack?.substring(0, 200),
            webhookSecretConfigured: !!webhookSecret,
            signaturePresent: !!signature
        }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400,
        });
    }
});

// ============================================================================
// Checkout Completed
// ============================================================================

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId || session.client_reference_id;
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;
    if (!userId) {
        console.error('[Webhook] No userId in checkout session');
        return;
    }

    if (!subscriptionId) {
        console.error('[Webhook] No subscription ID in checkout session');
        return;
    }

    console.log('[Webhook] Checkout completed for user:', userId);

    // Fetch authoritative data from Stripe BEFORE the upsert
    // so we write the correct current_period_end, status, and billing_interval.
    let billingInterval: string | null = null;
    let stripeStatus: string = 'active';
    let stripePeriodEnd: string | null = null;

    try {
        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceItem = stripeSub.items?.data?.[0]?.price;
        billingInterval = priceItem?.recurring?.interval === 'year' ? 'yearly' : 'monthly';
        stripeStatus = stripeSub.status;
        // Post 2025-03-31.basil: current_period_end moved to items.data[]
        const rawEnd = stripeSub.items?.data?.[0]?.current_period_end ?? stripeSub.current_period_end;
        stripePeriodEnd = typeof rawEnd === 'number'
            ? new Date(rawEnd * 1000).toISOString()
            : new Date(rawEnd).toISOString();
    } catch (err) {
        console.error('[Webhook] Error fetching Stripe subscription details:', err);
    }

    // Create or update subscription record
    const { error } = await supabase
        .from('subscriptions')
        .upsert({
            user_id: userId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            status: stripeStatus,
            cancel_at_period_end: false,
            billing_interval: billingInterval,
            current_period_end: stripePeriodEnd,
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'user_id'
        });

    if (error) {
        console.error('[Webhook] Error upserting subscription:', error);
        return;
    }

    console.log('[Webhook] Subscription created/updated for user:', userId);

    // Set project expiry: Pro users get no expiry, non-Pro get 14 days
    await supabase.rpc('set_project_expiry', {
        p_user_id: userId,
        p_expires_at: null, // New checkout = active Pro = no expiry
    });
}

// ============================================================================
// Subscription Updated / Created
// ============================================================================

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

    // Find user by customer ID and get old state
    const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('user_id, status')
        .eq('stripe_customer_id', customerId)
        .single();

    if (!existingSub) {
        console.error('[Webhook] No subscription found for customer:', customerId);
        return;
    }

    const userId = existingSub.user_id;
    const oldStatus = existingSub.status;

    const newStatus = subscription.status;
    // Post 2025-03-31.basil: current_period_end moved to items.data[]
    const rawPeriodEnd = subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end;
    const currentPeriodEnd = typeof rawPeriodEnd === 'number'
        ? new Date(rawPeriodEnd * 1000)
        : new Date(rawPeriodEnd);
    if (isNaN(currentPeriodEnd.getTime())) {
        console.error('[Webhook] Invalid current_period_end value:', rawPeriodEnd, 'type:', typeof rawPeriodEnd);
        throw new Error(`Invalid current_period_end: ${rawPeriodEnd}`);
    }
    const cancelAtPeriodEnd = subscription.cancel_at_period_end;

    console.log('[Webhook] Updating subscription:', { status: newStatus, customerId });

    const { error } = await supabase
        .from('subscriptions')
        .update({
            status: newStatus,
            current_period_end: currentPeriodEnd.toISOString(),
            cancel_at_period_end: cancelAtPeriodEnd,
            updated_at: new Date().toISOString(),
        })
        .eq('stripe_customer_id', customerId);

    if (error) {
        console.error('[Webhook] Error updating subscription:', error);
        return;
    }

    // Update project expiry based on new subscription status
    const isNowPro = newStatus === 'active' || newStatus === 'trialing' || newStatus === 'past_due';
    const wasPro = oldStatus === 'active' || oldStatus === 'trialing' || oldStatus === 'past_due';
    if (isNowPro && !wasPro) {
        // Regained Pro — clear expiry on all projects
        await supabase.rpc('set_project_expiry', { p_user_id: userId, p_expires_at: null });
    } else if (!isNowPro && wasPro) {
        // Lost Pro — set 14-day expiry on all projects
        await supabase.rpc('set_project_expiry', {
            p_user_id: userId,
            p_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        });
    }
}

// ============================================================================
// Subscription Deleted
// ============================================================================

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

    // Get user_id before updating
    const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();

    console.log('[Webhook] Subscription deleted for customer:', customerId);

    const { error } = await supabase
        .from('subscriptions')
        .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
        })
        .eq('stripe_customer_id', customerId);

    if (error) {
        console.error('[Webhook] Error marking subscription as canceled:', error);
        return;
    }

    // Set 14-day expiry on all projects (subscription deleted = lost Pro)
    if (existingSub) {
        await supabase.rpc('set_project_expiry', {
            p_user_id: existingSub.user_id,
            p_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        });
    }
}
