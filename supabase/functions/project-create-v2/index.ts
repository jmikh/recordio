import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

const BUCKET = 'project-media';

const EXT_MAP: Record<string, string> = {
    screen: 'webm',
    camera: 'webm',
    mic: 'wav',
};

/**
 * Project Upload v2 — TUS resumable upload variant.
 *
 * Same as project-create, but does NOT issue S3 presigned URLs. The client
 * uploads directly to Supabase Storage's TUS endpoint
 * (`/storage/v1/upload/resumable`) using its own JWT, with RLS on
 * `storage.objects` gating writes to `${auth.uid()}/...` paths.
 *
 * Chunked + resumable + per-chunk retry handled by tus-js-client. Slower than
 * S3 multipart presigned URLs, but more reliable on flaky / slow connections
 * because failed chunks are retried automatically and uploads can resume
 * within a session via tus-js-client's localStorage fingerprinting.
 *
 * Request:  { project, name?, workspaceId }
 * Response: { projectId, bucket, uploads: [{ fileType, storagePath }] }
 */
serve(withAuth('project-create-v2', async (req, { user }) => {
    // deno-lint-ignore no-explicit-any
    const { project, name, workspaceId } = await req.json() as { project: any; name?: string; workspaceId?: string };

    if (!workspaceId) return errorResponse('Missing workspaceId', 400);
    if (!project || !project.id) return errorResponse('Missing project or project.id', 400);

    const adminSupabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 1. Determine which media files exist and generate storage paths
    const projectId = project.id;
    const mediaFiles: { fileType: string; storagePath: string }[] = [];

    if (project.screenSource) {
        const sp = `${user.id}/${projectId}/screen.${EXT_MAP.screen}`;
        project.screenSource.storagePath = sp;
        mediaFiles.push({ fileType: 'screen', storagePath: sp });
    }
    if (project.cameraSource) {
        const sp = `${user.id}/${projectId}/camera.${EXT_MAP.camera}`;
        project.cameraSource.storagePath = sp;
        mediaFiles.push({ fileType: 'camera', storagePath: sp });
    }
    if (project.microphoneSource) {
        const sp = `${user.id}/${projectId}/mic.${EXT_MAP.mic}`;
        project.microphoneSource.storagePath = sp;
        mediaFiles.push({ fileType: 'mic', storagePath: sp });
    }

    // 2. Check workspace subscription to determine if project should expire
    const { data: sub } = await adminSupabase
        .from('subscriptions')
        .select('status')
        .eq('workspace_id', workspaceId)
        .maybeSingle();
    const hasActiveSub = sub?.status === 'active' || sub?.status === 'past_due';

    // 3. Save project to DB with upload_status='pending'
    const durationMs = project.timeline?.durationMs
        ? Math.round(project.timeline.durationMs)
        : null;

    console.log(`[project-create-v2] Upserting project ${projectId} into workspace ${workspaceId}`);
    const { error: upsertError } = await adminSupabase
        .from('projects')
        .upsert({
            id: projectId,
            workspace_id: workspaceId,
            created_by: user.id,
            owner_id: user.id,
            name: name ?? 'Untitled',
            project_data: project,
            upload_status: 'pending',
            duration_ms: durationMs,
            expires_at: hasActiveSub ? null : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        });

    if (upsertError) throw new Error('projects upsert failed', { cause: upsertError });

    console.log(`[project-create-v2] Done, returning ${mediaFiles.length} storage paths`);
    return jsonResponse({
        projectId,
        bucket: BUCKET,
        uploads: mediaFiles,
    });
}));
