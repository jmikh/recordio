-- asset_list(p_asset_type)
--
-- Returns active (ready, not deleted) assets for the authenticated user,
-- filtered by type. Ordered by created_at descending.
--
-- Called by: webapp UserAssetService.listAssets
-- Tables:   user_assets

CREATE OR REPLACE FUNCTION public.asset_list(p_asset_type TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'created_at') DESC), '[]'::jsonb)
    FROM (
        SELECT jsonb_build_object(
            'id', a.id,
            'asset_type', a.asset_type,
            'storage_path', a.storage_path,
            'name', a.name,
            'size_bytes', a.size_bytes,
            'created_at', a.created_at
        ) AS row_data
        FROM public.user_assets a
        WHERE a.user_id = auth.uid()
          AND a.asset_type = p_asset_type
          AND a.status = 'ready'
          AND a.is_deleted = false
    ) sub;
$$;
