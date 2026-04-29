import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
