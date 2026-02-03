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

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId || session.client_reference_id;
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;

    if (!userId) {
        console.error('[Webhook] No userId in checkout session');
        return;
    }

    console.log('[Webhook] Checkout completed for user:', userId);

    // Create or update subscription record
    const { error } = await supabase
        .from('subscriptions')
        .upsert({
            user_id: userId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            status: 'active',
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'user_id'
        });

    if (error) {
        console.error('[Webhook] Error upserting subscription:', error);
    } else {
        console.log('[Webhook] Subscription created/updated for user:', userId);
    }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

    // Find user by customer ID
    const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .single();

    if (!existingSub) {
        console.error('[Webhook] No subscription found for customer:', customerId);
        return;
    }

    const status = subscription.status;
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    const cancelAtPeriodEnd = subscription.cancel_at_period_end;

    console.log('[Webhook] Updating subscription:', { status, customerId });

    const { error } = await supabase
        .from('subscriptions')
        .update({
            status,
            current_period_end: currentPeriodEnd.toISOString(),
            cancel_at_period_end: cancelAtPeriodEnd,
            updated_at: new Date().toISOString(),
        })
        .eq('stripe_customer_id', customerId);

    if (error) {
        console.error('[Webhook] Error updating subscription:', error);
    }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const customerId = subscription.customer as string;

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
    }
}
