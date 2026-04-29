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
// Mixpanel Server-Side Tracking (HTTP API — no SDK needed)
// ============================================================================

const MIXPANEL_TOKEN = Deno.env.get('MIXPANEL_TOKEN') || '';

type PlanType = 'basic' | 'pro_trial' | 'pro';

function derivePlanType(status: string | null): PlanType {
    if (status === 'active') return 'pro';
    if (status === 'trialing') return 'pro_trial';
    return 'basic';
}

/** Track an event in Mixpanel via the /track HTTP API */
async function mpTrack(distinctId: string, event: string, properties: Record<string, any> = {}) {
    if (!MIXPANEL_TOKEN) return;
    try {
        await fetch('https://api.mixpanel.com/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/plain' },
            body: JSON.stringify([{
                event,
                properties: { token: MIXPANEL_TOKEN, distinct_id: distinctId, time: Date.now(), ...properties },
            }]),
        });
    } catch (err) {
        console.error('[Mixpanel] track error:', err);
    }
}

/** Set profile properties in Mixpanel via the /engage HTTP API */
async function mpPeopleSet(distinctId: string, properties: Record<string, any>) {
    if (!MIXPANEL_TOKEN) return;
    try {
        await fetch('https://api.mixpanel.com/engage#profile-set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/plain' },
            body: JSON.stringify([{
                $token: MIXPANEL_TOKEN,
                $distinct_id: distinctId,
                $set: properties,
            }]),
        });
    } catch (err) {
        console.error('[Mixpanel] people.set error:', err);
    }
}

/** Set profile properties only if not already set (idempotent) */
async function mpPeopleSetOnce(distinctId: string, properties: Record<string, any>) {
    if (!MIXPANEL_TOKEN) return;
    try {
        await fetch('https://api.mixpanel.com/engage#profile-set-once', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/plain' },
            body: JSON.stringify([{
                $token: MIXPANEL_TOKEN,
                $distinct_id: distinctId,
                $set_once: properties,
            }]),
        });
    } catch (err) {
        console.error('[Mixpanel] people.set_once error:', err);
    }
}

/** Record a revenue transaction in Mixpanel via the /engage HTTP API */
async function mpTrackCharge(distinctId: string, amount: number, properties: Record<string, any> = {}) {
    if (!MIXPANEL_TOKEN) return;
    try {
        await fetch('https://api.mixpanel.com/engage#profile-append', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/plain' },
            body: JSON.stringify([{
                $token: MIXPANEL_TOKEN,
                $distinct_id: distinctId,
                $append: {
                    $transactions: { $amount: amount, $time: new Date().toISOString(), ...properties },
                },
            }]),
        });
    } catch (err) {
        console.error('[Mixpanel] track_charge error:', err);
    }
}

/** Look up user email from Supabase auth */
async function getUserEmail(userId: string): Promise<string | null> {
    try {
        const { data } = await supabase.auth.admin.getUserById(userId);
        return data?.user?.email ?? null;
    } catch {
        return null;
    }
}

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
    const subscriptionId = session.subscription as string | null;
    const isLifetime = session.metadata?.interval === 'lifetime';

    if (!userId) {
        console.error('[Webhook] No userId in checkout session');
        return;
    }

    console.log('[Webhook] Checkout completed for user:', userId, isLifetime ? '(lifetime)' : '');

    // Read old status before upserting
    const { data: oldSub } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', userId)
        .maybeSingle();

    const previousPlanType = derivePlanType(oldSub?.status ?? null);

    // For recurring plans, fetch authoritative data from Stripe BEFORE the upsert
    // so we write the correct current_period_end, status, and billing_interval.
    // Without this, the stale trial current_period_end from the auth trigger persists.
    let billingInterval: string | null = isLifetime ? 'lifetime' : null;
    let priceAmount = 0;
    let currency = 'usd';
    let stripeStatus: string = 'active';
    let stripePeriodEnd: string | null = null;

    if (subscriptionId && !isLifetime) {
        try {
            const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
            const priceItem = stripeSub.items?.data?.[0]?.price;
            billingInterval = priceItem?.recurring?.interval === 'year' ? 'yearly' : 'monthly';
            priceAmount = priceItem?.unit_amount ?? 0;
            currency = priceItem?.currency ?? 'usd';
            stripeStatus = stripeSub.status;
            // Post 2025-03-31.basil: current_period_end moved to items.data[]
            const rawEnd = stripeSub.items?.data?.[0]?.current_period_end ?? stripeSub.current_period_end;
            stripePeriodEnd = typeof rawEnd === 'number'
                ? new Date(rawEnd * 1000).toISOString()
                : new Date(rawEnd).toISOString();
        } catch (err) {
            console.error('[Webhook] Error fetching Stripe subscription details:', err);
        }
    } else if (isLifetime) {
        priceAmount = session.amount_total ?? 0;
        currency = session.currency ?? 'usd';
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
            current_period_end: isLifetime ? null : stripePeriodEnd,
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

    // --- Mixpanel Tracking ---
    const email = await getUserEmail(userId);

    await mpPeopleSet(userId, {
        ...(email ? { $email: email } : {}),
        current_plan_type: 'pro',
        billing_interval: billingInterval,
        cancel_at_period_end: false,
        current_period_end: stripePeriodEnd,
    });

    // Set first_pro_date only once (preserved across churn/reactivation)
    await mpPeopleSetOnce(userId, { first_pro_date: new Date().toISOString() });

    // Track subscription created
    await mpTrack(userId, 'subscription_created', {
        plan_type: billingInterval,
        price: priceAmount,
        currency,
    });

    // Track revenue
    if (priceAmount > 0) {
        await mpTrackCharge(userId, priceAmount / 100, { plan_type: billingInterval });
    }
}

// ============================================================================
// Subscription Updated / Created
// ============================================================================

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

    // Find user by customer ID and get old state
    const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('user_id, status, current_period_end, cancel_at_period_end')
        .eq('stripe_customer_id', customerId)
        .single();

    if (!existingSub) {
        console.error('[Webhook] No subscription found for customer:', customerId);
        return;
    }

    const userId = existingSub.user_id;
    const oldStatus = existingSub.status;
    const oldCancelAtPeriodEnd = existingSub.cancel_at_period_end;
    const oldPeriodEnd = existingSub.current_period_end;

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
    const isNowPro = newStatus === 'active' || newStatus === 'trialing';
    const wasPro = oldStatus === 'active' || oldStatus === 'trialing';
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

    // --- Mixpanel Tracking ---
    const newPlanType = derivePlanType(newStatus);
    const oldPlanType = derivePlanType(oldStatus);

    // Get billing interval from Stripe subscription
    let billingInterval: string | null = null;
    try {
        const priceItem = subscription.items?.data?.[0]?.price;
        billingInterval = priceItem?.recurring
            ? (priceItem.recurring.interval === 'year' ? 'yearly' : 'monthly')
            : 'lifetime';
    } catch { /* ignore */ }

    // Update profile
    const profileUpdate: Record<string, any> = {
        current_plan_type: newPlanType,
        cancel_at_period_end: cancelAtPeriodEnd,
        billing_interval: billingInterval,
        current_period_end: currentPeriodEnd.toISOString(),
    };

    // Preserve last active plan when transitioning to basic
    if (newPlanType === 'basic' && oldPlanType !== 'basic') {
        profileUpdate.last_active_plan_type = oldPlanType;
        profileUpdate.last_active_plan_end_date = new Date().toISOString();
    }

    await mpPeopleSet(userId, profileUpdate);

    // Cancel scheduled? (cancel_at_period_end flipped to true)
    if (cancelAtPeriodEnd && !oldCancelAtPeriodEnd) {
        const remainingMs = currentPeriodEnd.getTime() - Date.now();
        const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
        await mpTrack(userId, 'subscription_cancel_scheduled', {
            plan_type: billingInterval,
            remaining_days: remainingDays,
            cancel_at: currentPeriodEnd.toISOString(),
        });
    }

    // Reactivated? (cancel_at_period_end flipped to false)
    if (!cancelAtPeriodEnd && oldCancelAtPeriodEnd) {
        await mpTrack(userId, 'subscription_reactivated', {
            plan_type: billingInterval,
        });
    }

    // Renewal? (status stayed active, period end moved forward)
    const isRenewal = oldStatus === 'active' && newStatus === 'active'
        && oldPeriodEnd && currentPeriodEnd.toISOString() > oldPeriodEnd;
    if (isRenewal) {
        let renewalAmount = 0;
        try {
            const priceItem = subscription.items?.data?.[0]?.price;
            renewalAmount = (priceItem?.unit_amount ?? 0) / 100;
        } catch { /* ignore */ }

        await mpTrack(userId, 'subscription_renewed', {
            plan_type: billingInterval,
            price: renewalAmount,
        });

        if (renewalAmount > 0) {
            await mpTrackCharge(userId, renewalAmount, { plan_type: billingInterval });
        }
    }
}

// ============================================================================
// Subscription Deleted
// ============================================================================

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

    // Get old state before updating
    const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('user_id, status')
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

    // --- Mixpanel Tracking ---
    if (existingSub) {
        const previousPlanType = derivePlanType(existingSub.status);

        // Get billing interval
        let billingInterval: string | null = null;
        try {
            const priceItem = subscription.items?.data?.[0]?.price;
            billingInterval = priceItem?.recurring
                ? (priceItem.recurring.interval === 'year' ? 'yearly' : 'monthly')
                : 'lifetime';
        } catch { /* ignore */ }

        await mpPeopleSet(existingSub.user_id, {
            current_plan_type: 'basic',
            cancel_at_period_end: false,
            billing_interval: null,
            current_period_end: null,
            last_active_plan_type: previousPlanType,
            last_active_plan_end_date: new Date().toISOString(),
        });

        if (previousPlanType !== 'basic') {
            await mpTrack(existingSub.user_id, 'subscription_canceled', {
                plan_type: billingInterval,
            });
        }
    }
}
