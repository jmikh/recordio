import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * Returns the project row if the user has editor access:
 * either they are the project owner (owner_id) or have an explicit row
 * in project_editors. Returns null if the project doesn't exist, is
 * deleted, or the user has no access.
 *
 * Always fetches `id` and `owner_id`. Pass additional column names in
 * `extraSelect` (e.g. ['slug', 'workspace_id']) to include them in the
 * returned row.
 *
 * Requires a service-role (admin) client so it can bypass RLS.
 */
export async function getProjectIfEditor(
    adminSupabase: SupabaseClient,
    projectId: string,
    userId: string,
    extraSelect: string[] = [],
// deno-lint-ignore no-explicit-any
): Promise<Record<string, any> | null> {
    const selectColumns = ['id', 'owner_id', ...extraSelect].join(', ');

    const { data: project } = await adminSupabase
        .from('projects')
        .select(selectColumns)
        .eq('id', projectId)
        .is('deleted_at', null)
        .maybeSingle();

    if (!project) return null;

    // Owner has implicit editor access
    if (project.owner_id === userId) return project;

    // Check explicit project_editors row
    const { data: editorRow } = await adminSupabase
        .from('project_editors')
        .select('user_id')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .maybeSingle();

    return editorRow ? project : null;
}
