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
 * Authenticates user, checks for cache hit / dedup, cancels stale jobs,
 * generates signed media URLs, creates a render_jobs row, and dispatches
 * work to the Fly.io render worker. The worker receives only signed URLs —
 * no Supabase credentials.
 *
 * Request body: { projectId }
 * Response:     { jobId, status }
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
        .select('id, name, project_data, cloud_version, duration_ms')
        .eq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();

    if (projectError || !project) {
        return errorResponse('Project not found', 404);
    }

    const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 4. Cache hit: completed job with same project_id + cloud_version
    const { data: cached } = await adminSupabase
        .from('render_jobs')
        .select('id, status')
        .eq('project_id', projectId)
        .eq('cloud_version', project.cloud_version)
        .eq('status', 'completed')
        .maybeSingle();

    if (cached) {
        return jsonResponse({ jobId: cached.id, status: 'completed' });
    }

    // 5. Dedup: pending job with same project_id + cloud_version
    const { data: pending } = await adminSupabase
        .from('render_jobs')
        .select('id, status')
        .eq('project_id', projectId)
        .eq('cloud_version', project.cloud_version)
        .eq('status', 'pending')
        .maybeSingle();

    if (pending) {
        return jsonResponse({ jobId: pending.id, status: 'pending' });
    }

    // 6. Cancel stale: set all pending jobs for this project to canceled
    await adminSupabase
        .from('render_jobs')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('project_id', projectId)
        .eq('status', 'pending');

    // 7. Generate signed download URLs for media (1h expiry)
    //    Uses getProjectMediaPaths() to extract storagePaths from project_data,
    //    so new media types are picked up automatically.
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

    // 8. Generate signed upload URL for output
    const outputStoragePath = `${user.id}/${projectId}/render_1080p.mp4`;

    const { data: uploadData, error: uploadError } = await adminSupabase
        .storage.from(BUCKET)
        .createSignedUploadUrl(outputStoragePath, { upsert: true });

    if (uploadError || !uploadData) {
        console.error('[render-start-job] Failed to create upload URL:', uploadError);
        return errorResponse('Failed to create upload URL', 500);
    }

    // 9. Insert render_jobs row
    const { data: job, error: insertError } = await adminSupabase
        .from('render_jobs')
        .insert({
            project_id: projectId,
            user_id: user.id,
            quality: '1080p',
            cloud_version: project.cloud_version,
            output_storage_path: outputStoragePath,
            video_duration_s: project.duration_ms ? project.duration_ms / 1000 : null,
        })
        .select('id')
        .single();

    if (insertError || !job) {
        console.error('[render-start-job] Failed to create job:', insertError);
        return errorResponse('Failed to create render job', 500);
    }

    // 10. Dispatch to worker (fire-and-forget)
    const statusCallbackUrl = `${SUPABASE_URL}/functions/v1/render-update-status`;

    fetch(`${RENDER_WORKER_URL}/render`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RENDER_SECRET}`,
        },
        body: JSON.stringify({
            jobId: job.id,
            projectData: project.project_data,
            projectName: project.name,
            quality: '1080p',
            mediaUrls,
            uploadUrl: uploadData.signedUrl,
            statusCallbackUrl,
        }),
    }).catch(err => {
        console.error('[render-start-job] Worker dispatch failed:', err);
    });

    // 11. Job created — worker will pick it up
    return jsonResponse({ jobId: job.id, status: 'pending' });
}));
