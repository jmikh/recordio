import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const MIXPANEL_TOKEN = '773bc18d036f7f77ec70ec94e7eec508';

/** Track an event in Mixpanel via the /track HTTP API */
async function trackEvent(eventName: string, distinctId: string, properties: Record<string, any> = {}) {
    try {
        await fetch('https://api.mixpanel.com/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/plain' },
            body: JSON.stringify([{
                event: eventName,
                properties: { token: MIXPANEL_TOKEN, distinct_id: distinctId, time: Date.now(), ...properties },
            }]),
        });
    } catch (err) {
        console.error('[OnUserCreated] Mixpanel track error:', err);
    }
}

/** Set profile properties in Mixpanel via the /engage HTTP API */
async function peopleSet(distinctId: string, properties: Record<string, any>) {
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
        console.error('[OnUserCreated] Mixpanel people.set error:', err);
    }
}

// ============================================================================
// Handler — triggered by Database Webhook on auth.users INSERT
// ============================================================================

serve(async (req) => {
    try {
        const payload = await req.json();

        const record = payload.record;
        if (!record) {
            console.error('[OnUserCreated] No record in payload');
            return new Response(JSON.stringify({ error: 'No record' }), { status: 400 });
        }

        const userId: string = record.id;
        const email: string | undefined = record.email;
        const provider: string = record.raw_app_meta_data?.provider ?? 'unknown';

        // Compute trial end (matches handle_new_user trigger: 7 days)
        const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        // Set Mixpanel profile
        await peopleSet(userId, {
            $email: email ?? undefined,
            current_plan_type: 'pro_trial',
            cancel_at_period_end: true,
            current_period_end: trialEnd,
            signup_date: new Date().toISOString(),
        });

        // Fire account_created event
        await trackEvent('account_created', userId, {
            email: email ?? undefined,
            signup_method: provider,
        });

        console.log('[OnUserCreated] Mixpanel profile set + account_created tracked for:', userId);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[OnUserCreated] Error:', message);
        return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
});
