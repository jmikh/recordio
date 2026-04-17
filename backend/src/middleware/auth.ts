import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

// Service-role Supabase client — used for JWT verification and DB queries
const supabase: SupabaseClient = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SECRET_KEY
);

export interface AuthenticatedUser {
    userId: string;
    subscriptionStatus: string;
    currentPeriodEnd: Date;
    billingInterval: string | null;
}

/**
 * Authenticate request, verify pro access, and attach user info.
 * Returns the authenticated user or sends an error response.
 */
export async function authenticateRequest(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<AuthenticatedUser | null> {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'missing_token', message: 'Authorization header required' });
        return null;
    }

    const token = authHeader.slice(7);

    // Verify JWT
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
        reply.code(401).send({ error: 'invalid_token', message: 'Invalid or expired token' });
        return null;
    }

    // Check subscription status
    const { data: subscription, error: subError } = await supabase
        .from('subscriptions')
        .select('status, current_period_end, billing_interval')
        .eq('user_id', user.id)
        .maybeSingle();

    if (subError) {
        request.log.error({ err: subError }, 'Failed to query subscription');
        reply.code(500).send({ error: 'internal', message: 'Failed to verify subscription' });
        return null;
    }

    const status = subscription?.status;
    if (status !== 'active' && status !== 'trialing') {
        reply.code(403).send({ error: 'pro_required', message: 'Pro subscription required' });
        return null;
    }

    if (!subscription.current_period_end) {
        reply.code(500).send({ error: 'internal', message: 'Subscription missing period end date' });
        return null;
    }

    return {
        userId: user.id,
        subscriptionStatus: status,
        currentPeriodEnd: new Date(subscription.current_period_end),
        billingInterval: subscription.billing_interval,
    };
}

export { supabase };
