import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/auth.ts';
import { getProjectMediaPaths } from '../_shared/projectMedia.ts';

const RENDER_WORKER_URL = Deno.env.get('RENDER_WORKER_URL')!;
const RENDER_SECRET = Deno.env.get('RENDER_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const BUCKET = 'project-media';

/**
 * Render Start Edge Function
 *
 * Two auth paths:
 *   1. User JWT: checks Pro subscription, RLS-enforced project lookup
 *   2. Service role key (from mux-video-create): skips Pro check, uses admin client
 *
 * Request body: { projectId, cloudVersion }
 * Response:     { jobId, status, renderStoragePath? }
 */
serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return errorResponse('Unauthorized', 401);
        }

        const { projectId, cloudVersion } = await req.json();
        if (!projectId) {
            return errorResponse('Missing projectId', 400);
        }
        if (cloudVersion === undefined || cloudVersion === null) {
            return errorResponse('Missing cloudVersion', 400);
        }

        const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const isServiceRole = authHeader === `Bearer ${SERVICE_ROLE_KEY}`;

        let userId: string;

        if (isServiceRole) {
            // Service role path: called internally by mux-video-create
            const { data: proj } = await adminSupabase
                .from('projects')
                .select('user_id')
                .eq('id', projectId)
                .is('deleted_at', null)
                .maybeSingle();

            if (!proj) {
                return errorResponse('Project not found', 404);
            }

            userId = proj.user_id;
        } else {
            // User JWT path: authenticate, check Pro subscription
            const userSupabase = createClient(
                SUPABASE_URL,
                Deno.env.get('SUPABASE_ANON_KEY') ?? '',
                { global: { headers: { Authorization: authHeader } } },
            );

            const { data: { user }, error: authError } = await userSupabase.auth.getUser();
            if (authError || !user) {
                return errorResponse('Unauthorized', 401);
            }

            userId = user.id;

            // Check Pro subscription
            const { data: subscription } = await userSupabase
                .from('subscriptions')
                .select('status')
                .eq('user_id', user.id)
                .maybeSingle();

            const hasAccess = subscription?.status === 'active' || subscription?.status === 'trialing';
            if (!hasAccess) {
                return jsonResponse({ error: 'pro_required', message: 'Pro subscription required for server rendering.' }, 403);
            }

            // Verify project belongs to user (RLS check)
            const { data: rlsCheck } = await userSupabase
                .from('projects')
                .select('id')
                .eq('id', projectId)
                .is('deleted_at', null)
                .maybeSingle();

            if (!rlsCheck) {
                return errorResponse('Project not found', 404);
            }
        }

        // From here, both paths converge — we have projectId, userId, cloudVersion

        // Look up project data with admin client
        const { data: project, error: projectError } = await adminSupabase
            .from('projects')
            .select('id, name, project_data, duration_ms')
            .eq('id', projectId)
            .is('deleted_at', null)
            .maybeSingle();

        if (projectError || !project) {
            return errorResponse('Project not found', 404);
        }

        // Atomic cache-hit / dedup / cancel stale / insert via DB function
        const { data: jobResult, error: rpcError } = await adminSupabase
            .rpc('render_job_get_or_create', {
                p_project_id: projectId,
                p_user_id: userId,
                p_cloud_version: cloudVersion,
            })
            .single();

        if (rpcError || !jobResult) {
            console.error('[render-start] render_job_get_or_create failed:', rpcError);
            return errorResponse('Failed to create render job', 500);
        }

        console.log(`[render-start] Resolved: status=${jobResult.status}, is_new=${jobResult.is_new}, job_id=${jobResult.job_id}`);

        // Cache hit or dedup — return without dispatching to worker
        if (!jobResult.is_new) {
            console.log(`[render-start] Skipping dispatch: ${jobResult.status === 'completed' ? 'render already done' : 'job already in progress'}`);
            return jsonResponse({
                jobId: jobResult.job_id,
                status: jobResult.status,
                renderStoragePath: jobResult.render_storage_path,
            });
        }

        // Generate signed download URLs for media (1h expiry)
        console.log(`[render-start] New job ${jobResult.job_id}, signing media URLs`);
        const mediaEntries = getProjectMediaPaths(project.project_data);
        const mediaUrls: Record<string, string> = {};

        for (const entry of mediaEntries) {
            const { data, error } = await adminSupabase
                .storage.from(BUCKET)
                .createSignedUrl(entry.storagePath, 3600);
            if (error || !data) {
                console.error(`[render-start] Failed to sign ${entry.storagePath}:`, error);
                return errorResponse(`Failed to create signed URL for ${entry.type}`, 500);
            }
            mediaUrls[entry.storagePath] = data.signedUrl;
        }

        // Generate signed upload URL for output
        const { data: uploadData, error: uploadError } = await adminSupabase
            .storage.from(BUCKET)
            .createSignedUploadUrl(jobResult.render_storage_path, { upsert: true });

        if (uploadError || !uploadData) {
            console.error('[render-start] Failed to create upload URL:', uploadError);
            return errorResponse('Failed to create upload URL', 500);
        }

        // Dispatch to worker (fire-and-forget)
        const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/render-hook`;
        console.log(`[render-start] Dispatching job ${jobResult.job_id} to worker, upload path: ${jobResult.render_storage_path}`);

        fetch(`${RENDER_WORKER_URL}/render`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RENDER_SECRET}`,
            },
            body: JSON.stringify({
                jobId: jobResult.job_id,
                projectData: project.project_data,
                projectName: project.name,
                quality: '1080p',
                mediaUrls,
                uploadUrl: uploadData.signedUrl,
                statusCallbackUrl,
            }),
        }).catch(err => {
            console.error('[render-start] Worker dispatch failed:', err);
        });

        return jsonResponse({
            jobId: jobResult.job_id,
            status: 'pending',
            renderStoragePath: jobResult.render_storage_path,
        });
    } catch (err) {
        console.error('[render-start] Unexpected error:', err);
        return errorResponse('Internal server error', 500);
    }
});
