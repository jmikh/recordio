-- Add soft delete and upload lifecycle columns to user_assets

-- Soft delete support
ALTER TABLE public.user_assets ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

-- Upload lifecycle: pending → ready (mirrors projects pattern)
ALTER TABLE public.user_assets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';

-- Index for library queries (active, ready assets only)
CREATE INDEX IF NOT EXISTS idx_user_assets_active
    ON public.user_assets(user_id, asset_type)
    WHERE is_deleted = false AND status = 'ready';
