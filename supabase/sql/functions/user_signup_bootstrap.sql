-- user_signup_bootstrap()
--
-- Bootstraps a new user's account: their one owned workspace (revamp
-- Step 2 — created at signup, undeletable, trial via the column default
-- now() + 7 days) and their profile pointing at it as the default.
-- No workspace_members row — owner is its own state (workspaces.owner_id)
-- and implies admin; the members table holds invited members only.
-- Called by: on_user_signup_bootstrap trigger (auth.users INSERT)
-- Tables:   workspaces, user_profiles

CREATE OR REPLACE FUNCTION public.user_signup_bootstrap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    ws_id UUID;
BEGIN
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('My Workspace', new.id)
    RETURNING id INTO ws_id;

    INSERT INTO public.user_profiles (user_id, name, default_workspace_id, updated_at)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
        ws_id,
        now()
    );

    RETURN new;
END;
$$;
