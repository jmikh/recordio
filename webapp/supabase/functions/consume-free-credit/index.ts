import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Parse request body for project_id
        const body = await req.json().catch(() => ({}));
        const projectId = body.project_id;
        if (!projectId || typeof projectId !== 'string') {
            return new Response(
                JSON.stringify({ error: 'project_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Create authenticated client to verify the user
        const supabaseAuth = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized: Invalid user' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Use service role client for the atomic update (bypasses RLS)
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        // Check if project is already unlocked
        const { data: existing } = await supabaseAdmin
            .from('project_unlocks')
            .select('project_id')
            .eq('user_id', user.id)
            .eq('project_id', projectId)
            .maybeSingle();

        if (existing) {
            // Already unlocked — no credit needed
            const { data: meta } = await supabaseAdmin
                .from('user_metadata')
                .select('free_credits_remaining')
                .eq('id', user.id)
                .single();

            return new Response(
                JSON.stringify({ success: true, alreadyUnlocked: true, creditsRemaining: meta?.free_credits_remaining ?? 0 }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            );
        }

        // Atomically decrement free_credits_remaining only if > 0
        const { data, error } = await supabaseAdmin.rpc('decrement_credit_and_unlock', {
            p_user_id: user.id,
            p_project_id: projectId,
        });

        // If the RPC doesn't exist yet, fall back to manual two-step
        if (error?.message?.includes('function') || error?.code === '42883') {
            // Fallback: manual atomic-ish operation
            const { data: meta, error: updateError } = await supabaseAdmin
                .from('user_metadata')
                .update({
                    free_credits_remaining: 0, // Will be replaced by proper decrement
                    updated_at: new Date().toISOString(),
                })
                .eq('id', user.id)
                .gt('free_credits_remaining', 0)
                .select('free_credits_remaining')
                .single();

            if (updateError || !meta) {
                console.log('[FreeCredit] No credits remaining for user:', user.id);
                return new Response(
                    JSON.stringify({ success: false, creditsRemaining: 0 }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
                );
            }

            // Insert unlock record
            await supabaseAdmin
                .from('project_unlocks')
                .insert({ user_id: user.id, project_id: projectId })
                .single();

            console.log('[FreeCredit] Credit consumed, project unlocked:', user.id, projectId);
            return new Response(
                JSON.stringify({ success: true, creditsRemaining: meta.free_credits_remaining }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            );
        }

        if (error) {
            console.error('[FreeCredit] RPC error:', error);
            return new Response(
                JSON.stringify({ success: false, creditsRemaining: 0 }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
            );
        }

        // RPC succeeded
        const remaining = data?.credits_remaining ?? 0;
        console.log('[FreeCredit] Credit consumed via RPC, project unlocked:', user.id, projectId);
        return new Response(
            JSON.stringify({ success: true, creditsRemaining: remaining }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
    } catch (error) {
        console.error('[FreeCredit] Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return new Response(
            JSON.stringify({ error: errorMessage }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
    }
});
