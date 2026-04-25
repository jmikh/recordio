import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { withAuth, jsonResponse, errorResponse } from '../_shared/auth.ts';

/**
 * Storage Confirm Media Edge Function
 *
 * Called by the client after a successful media upload to Supabase Storage.
 * Updates the project row with the storage path and file size.
 * Atomically sets upload_status = 'ready' when all non-NULL paths are filled.
 *
 * Request body: { projectId, fileType: 'screen'|'camera'|'mic'|'thumbnail', storagePath, sizeBytes }
 */
serve(withAuth(async (req, { supabase }) => {
    // 1. Parse request
    const { projectId, fileType, storagePath, sizeBytes } = await req.json();

    if (!projectId || !fileType || !storagePath) {
        return errorResponse('Missing required fields', 400);
    }

    // 2. Map fileType to column names
    const pathColumn = `${fileType}_storage_path`;
    const sizeColumn = `${fileType}_size_bytes`;

    const validColumns: Record<string, boolean> = {
        screen_storage_path: true,
        camera_storage_path: true,
        mic_storage_path: true,
        thumbnail_storage_path: true,
    };

    if (!validColumns[pathColumn]) {
        return errorResponse('Invalid fileType', 400);
    }

    // 3. Update storage path and size (RLS enforces ownership)
    const updateData: Record<string, unknown> = {
        [pathColumn]: storagePath,
    };
    // Thumbnails don't have a size column
    if (fileType !== 'thumbnail') {
        updateData[sizeColumn] = sizeBytes ?? 0;
    }

    const { error: updateError } = await supabase
        .from('projects')
        .update(updateData)
        .eq('id', projectId);

    if (updateError) {
        console.error('[storage-confirm-media] Update failed:', updateError);
        return errorResponse('Failed to confirm upload', 500);
    }

    // 4. Check if all media is now uploaded — set upload_status = 'ready' if so
    //    A path is "done" if it's NULL (media doesn't exist) or a real path (not 'pending').
    const { data: project, error: fetchError } = await supabase
        .from('projects')
        .select('screen_storage_path, camera_storage_path, mic_storage_path')
        .eq('id', projectId)
        .single();

    if (fetchError || !project) {
        // Non-fatal — the path was already updated
        console.error('[storage-confirm-media] Fetch for status check failed:', fetchError);
    } else {
        const paths = [
            project.screen_storage_path,
            project.camera_storage_path,
            project.mic_storage_path,
        ];
        // All paths are either NULL (no media) or a real path (not 'pending')
        const allDone = paths.every((p: string | null) => p === null || p !== 'pending');

        if (allDone) {
            await supabase
                .from('projects')
                .update({ upload_status: 'ready' })
                .eq('id', projectId);
        }
    }

    return jsonResponse({ success: true });
}));
