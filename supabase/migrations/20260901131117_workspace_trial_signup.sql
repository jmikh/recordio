-- Billing revamp Step 2 — workspace lifecycle: one per user, created at
-- signup (plans/workspace-billing-revamp/workspace-billing-revamp-step-2.md).
--
-- 1) The trial moves onto workspaces (trial_ends_at + trial_extension_count);
--    entitlements stop reading user_profiles.trial_ends_at (column dropped
--    in revamp Step 8).
-- 2) Every auth user owns exactly one workspace: backfill here, the
--    sql/triggers/on_user_signup_bootstrap.sql trigger covers new signups.
-- 3) Owner is its own state (workspaces.owner_id, implies admin): owners
--    lose their workspace_members rows — the table now holds invited
--    members only.
-- 4) Auth-user deletion cascades owned workspaces and memberships.

-- 1. Trial columns. The trial default is attached AFTER the backfill —
-- adding it on ADD COLUMN would stamp every existing workspace with a
-- fresh 7-day trial via the table rewrite.
ALTER TABLE public.workspaces
    ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trial_extension_count INTEGER NOT NULL DEFAULT 0;

-- 2. Every auth user owns a workspace (users who only ever joined others'
-- workspaces get their own), and default_workspace_id is healed where unset.
INSERT INTO public.workspaces (name, owner_id)
SELECT 'My Workspace', u.id
FROM auth.users u
WHERE NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.owner_id = u.id AND w.deleted_at IS NULL
);

UPDATE public.user_profiles up
SET default_workspace_id = (
    SELECT w.id FROM public.workspaces w
    WHERE w.owner_id = up.user_id AND w.deleted_at IS NULL
    ORDER BY w.created_at ASC LIMIT 1
)
WHERE up.default_workspace_id IS NULL;

-- 3. Owner is its own state — drop their membership rows.
DELETE FROM public.workspace_members wm
USING public.workspaces w
WHERE wm.workspace_id = w.id AND wm.user_id = w.owner_id;

-- 4. Trial backfill: the owner's profile trial verbatim (behavior-
-- preserving — the Step 1 interim derived every owned workspace's trial
-- from the owner's profile); NULL (the signup-trial-gap cohort + owners
-- without a profile row) means "ends now" — free today, primed for the
-- Step 3 self-serve extension (+7d from extension date, count = 0).
-- Ever-pro workspaces get a value too; it is inert behind the one-way
-- door (a subscription row exists ⇒ never trial).
UPDATE public.workspaces w
SET trial_ends_at = COALESCE(up.trial_ends_at, now())
FROM public.user_profiles up
WHERE up.user_id = w.owner_id;

UPDATE public.workspaces
SET trial_ends_at = now()
WHERE trial_ends_at IS NULL;

ALTER TABLE public.workspaces
    ALTER COLUMN trial_ends_at SET DEFAULT now() + interval '7 days',
    ALTER COLUMN trial_ends_at SET NOT NULL;

-- 5. Auth-user deletion cascades ownership + membership (previously
-- orphaned both). projects.owner_id/workspace_id stay NO ACTION — there
-- is no account-deletion route; revisit when one exists.
ALTER TABLE public.workspaces
    DROP CONSTRAINT IF EXISTS workspaces_owner_id_fkey;
ALTER TABLE public.workspaces
    ADD CONSTRAINT workspaces_owner_id_fkey
        FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.workspace_members
    DROP CONSTRAINT IF EXISTS workspace_members_user_id_fkey;
ALTER TABLE public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
