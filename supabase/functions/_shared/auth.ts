import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * Check if a user has Pro access: active Stripe subscription OR active free trial.
 * Mirrors the webapp's useUserStore.hasProAccess().
 *
 * Uses a service-role client to read both `subscriptions` and `user_profiles`
 * so it works regardless of RLS context.
 */
export async function hasProAccess(userId: string): Promise<boolean> {
    const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Check Stripe subscription (only real paid subs live here now)
    const { data: sub } = await adminSupabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', userId)
        .maybeSingle();

    if (sub?.status === 'active' || sub?.status === 'trialing') {
        return true;
    }

    // Check free trial from user_profiles
    const { data: profile } = await adminSupabase
        .from('user_profiles')
        .select('trial_ends_at')
        .eq('user_id', userId)
        .maybeSingle();

    if (profile?.trial_ends_at && new Date(profile.trial_ends_at).getTime() > Date.now()) {
        return true;
    }

    return false;
}

export interface AuthContext {
    user: { id: string; email?: string; user_metadata: Record<string, unknown> };
    supabase: SupabaseClient;
}

/** Wrap any data in a JSON Response with CORS headers. */
export function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

/** Shorthand for `jsonResponse({ error }, status)`. */
export function errorResponse(error: string, status: number): Response {
    return jsonResponse({ error }, status);
}

type AuthHandler = (req: Request, ctx: AuthContext) => Promise<Response>;

/**
 * Wraps an edge-function handler with CORS preflight, JWT auth, and
 * a catch-all error handler. The inner handler receives the authenticated
 * user and a user-scoped Supabase client.
 */
export function withAuth(handler: AuthHandler): (req: Request) => Promise<Response> {
    return async (req: Request) => {
        if (req.method === 'OPTIONS') {
            return new Response('ok', { headers: corsHeaders });
        }

        try {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader) {
                return errorResponse('Unauthorized', 401);
            }

            const supabase = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_ANON_KEY') ?? '',
                { global: { headers: { Authorization: authHeader } } },
            );

            const { data: { user }, error: authError } = await supabase.auth.getUser();
            if (authError || !user) {
                return errorResponse('Unauthorized', 401);
            }

            return await handler(req, { user, supabase });
        } catch (err) {
            console.error('Unexpected error:', err);
            return errorResponse('Internal server error', 500);
        }
    };
}
