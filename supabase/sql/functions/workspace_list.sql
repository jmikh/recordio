-- workspace_list()
--
-- Returns all workspaces the caller is a member of,
-- including the caller's role in each workspace.
-- Excludes soft-deleted workspaces.
--
-- Called by: webapp workspace switcher, settings
-- Tables:   workspaces, workspace_members

CREATE OR REPLACE FUNCTION public.workspace_list()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'is_personal') DESC, (row_data->>'name') ASC), '[]'::jsonb)
    FROM (
        SELECT jsonb_build_object(
            'id',          w.id,
            'name',        w.name,
            'owner_id',    w.owner_id,
            'is_personal', w.is_personal,
            'role',        wm.role,
            'seats',       (SELECT s.seats FROM public.subscriptions s WHERE s.workspace_id = w.id LIMIT 1),
            'created_at',  w.created_at,
            'updated_at',  w.updated_at
        ) AS row_data
        FROM public.workspaces w
        JOIN public.workspace_members wm ON wm.workspace_id = w.id
        WHERE wm.user_id = auth.uid()
          AND w.deleted_at IS NULL
    ) sub;
$$;
