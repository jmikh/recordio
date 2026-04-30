import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';
import { getProjectMediaPaths } from '../_shared/projectMedia.ts';

const RENDER_WORKER_URL = Deno.env.get('RENDER_WORKER_URL')!;
const RENDER_SECRET = Deno.env.get('RENDER_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const BUCKET = 'project-media';

/**
 * Render Start Job Edge Function
 *
 * Authenticates user, atomically checks cache/dedup/creates a render job,
 * generates signed media URLs, and dispatches work to the Cloud Run render
 * worker. The worker receives only signed URLs — no Supabase credentials.
 *
 * Request body: { projectId }
 * Response:     { jobId?, status }
 */
serve(withAuth(async (req, { user, supabase }) => {
    // 1. Check Pro subscription
    const { data: subscription } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle();

    const hasAccess = subscription?.status === 'active' || subscription?.status === 'trialing';
    if (!hasAccess) {
        return jsonResponse({ error: 'pro_required', message: 'Pro subscription required for server rendering.' }, 403);
    }

    // 2. Parse request
    const { projectId } = await req.json();
    if (!projectId) {
        return errorResponse('Missing projectId', 400);
    }

    // 3. Look up project (RLS enforced — must belong to user)
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id, name, project_data, duration_ms')
        .eq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();

    if (projectError || !project) {
        return errorResponse('Project not found', 404);
    }

    const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 4. Atomic cache-hit / dedup / cancel stale / insert via DB function
    const { data: jobResult, error: rpcError } = await adminSupabase
        .rpc('render_job_start', {
            p_project_id: projectId,
            p_user_id: user.id,
        })
        .single();

    if (rpcError || !jobResult) {
        console.error('[render-start-job] Failed to create job:', rpcError);
        return errorResponse('Failed to create render job', 500);
    }

    // Cache hit or dedup — return without dispatching to worker
    if (!jobResult.is_new) {
        return jsonResponse({ jobId: jobResult.job_id, status: jobResult.status });
    }

    // 5. Generate signed download URLs for media (1h expiry)
    const mediaEntries = getProjectMediaPaths(project.project_data);
    const mediaUrls: Record<string, string> = {};

    for (const entry of mediaEntries) {
        const { data, error } = await adminSupabase
            .storage.from(BUCKET)
            .createSignedUrl(entry.storagePath, 3600);
        if (error || !data) {
            console.error(`[render-start-job] Failed to sign ${entry.storagePath}:`, error);
            return errorResponse(`Failed to create signed URL for ${entry.type}`, 500);
        }
        mediaUrls[entry.storagePath] = data.signedUrl;
    }

    // 6. Generate signed upload URL for output (path defined by render_job_start)
    const { data: uploadData, error: uploadError } = await adminSupabase
        .storage.from(BUCKET)
        .createSignedUploadUrl(jobResult.render_storage_path, { upsert: true });

    if (uploadError || !uploadData) {
        console.error('[render-start-job] Failed to create upload URL:', uploadError);
        return errorResponse('Failed to create upload URL', 500);
    }

    // 7. Dispatch to worker (fire-and-forget)
    const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/render-update-status`;

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
            mediaUrls,
            uploadUrl: uploadData.signedUrl,
            statusCallbackUrl,
        }),
    }).catch(err => {
        console.error('[render-start-job] Worker dispatch failed:', err);
    });

    // 8. Job created — worker will pick it up
    return jsonResponse({ jobId: jobResult.job_id, status: 'pending' });
}));
