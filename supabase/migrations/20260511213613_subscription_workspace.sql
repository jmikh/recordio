-- ============================================================
-- Make subscriptions workspace-scoped
--
-- Subscriptions are now keyed by workspace rather than user.
-- Each workspace can have its own subscription (personal
-- workspaces get a free/inactive row; team workspaces can have
-- pro or business tiers with seats).
--
-- Follows the same nullable-first → backfill → NOT NULL pattern
-- used for projects/folders in 20260511182449_workspace_infrastructure.
-- ============================================================


-- 1. Add new columns (nullable first)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS seats        INT  CHECK (seats IS NULL OR seats > 0);


-- 2. Backfill workspace_id from each user's personal workspace
UPDATE public.subscriptions s
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.owner_id  = s.user_id
  AND w.is_personal = TRUE
  AND s.workspace_id IS NULL;


-- 3. Enforce NOT NULL
ALTER TABLE public.subscriptions
  ALTER COLUMN workspace_id SET NOT NULL;


-- 4. Swap primary key: drop user_id PK, promote workspace_id
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_pkey,
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_key;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (workspace_id);


-- 5. Index for fast user-level lookups (billing, Stripe webhook)
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions (user_id);


-- 6. Update RLS: any workspace member can read their workspace subscription
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;

CREATE POLICY "subscriptions_select"
  ON public.subscriptions FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = subscriptions.workspace_id
        AND user_id = auth.uid()
    )
  );
