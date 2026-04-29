-- asset_delete(p_asset_id)
--
-- Soft-deletes a user asset (is_deleted = true).
-- Returns the storage_path so the client can evict from local cache.
-- Returns NULL if the asset doesn't exist or isn't owned by the caller.
--
-- Called by: webapp UserAssetService.deleteAsset
-- Tables:   user_assets

CREATE OR REPLACE FUNCTION public.asset_delete(p_asset_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    path TEXT;
BEGIN
    UPDATE public.user_assets
    SET is_deleted = true
    WHERE id = p_asset_id
      AND user_id = auth.uid()
    RETURNING storage_path INTO path;

    RETURN path;
END;
$$;
