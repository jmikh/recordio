import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { captureException } from './sentry.ts';

export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

type SupabaseClient = ReturnType<typeof createClient>;

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
type RawHandler = (req: Request) => Promise<Response>;

/**
 * Wraps an edge-function handler with CORS preflight, JWT auth, and
 * a catch-all error handler. The inner handler receives the authenticated
 * user and a user-scoped Supabase client.
 */
export function withAuth(name: string, handler: AuthHandler): RawHandler {
    return async (req: Request) => {
        if (req.method === 'OPTIONS') {
            return new Response('ok', { headers: corsHeaders });
        }

        let userId: string | undefined;

        try {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader) {
                console.error(`[${name}] No Authorization header`);
                return errorResponse('Unauthorized', 401);
            }

            const supabase = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_ANON_KEY') ?? '',
                { global: { headers: { Authorization: authHeader } } },
            );

            const { data: { user }, error: authError } = await supabase.auth.getUser();
            if (authError || !user) {
                console.error(`[${name}] auth.getUser() failed:`, authError?.message ?? 'no user');
                return errorResponse('Unauthorized', 401);
            }

            userId = user.id;
            return await handler(req, { user, supabase });
        } catch (err) {
            console.error(`[${name}] Unexpected error:`, err);
            await captureException(err, name, userId ? { userId } : undefined);
            return errorResponse('Internal server error', 500);
        }
    };
}

/**
 * Wraps a non-JWT edge-function handler (webhooks, crons, internal callers)
 * with CORS preflight and a catch-all that captures uncaught errors to Sentry.
 *
 * Use this for any function that doesn't go through `withAuth`. Let internal
 * errors throw — the boundary reports them. Use `errorResponse(..., 4xx)`
 * for user-facing validation; reserve throws for actual bugs.
 */
export function withBoundary(name: string, handler: RawHandler): RawHandler {
    return async (req: Request) => {
        if (req.method === 'OPTIONS') {
            return new Response('ok', { headers: corsHeaders });
        }
        try {
            return await handler(req);
        } catch (err) {
            console.error(`[${name}] Unexpected error:`, err);
            await captureException(err, name);
            return errorResponse('Internal server error', 500);
        }
    };
}
