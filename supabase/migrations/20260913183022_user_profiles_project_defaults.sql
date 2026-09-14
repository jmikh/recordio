-- Personal default project settings (plans/user-default-project-settings).
-- Holds { schemaVersion, settings } — the ProjectSettings sub-tree a user
-- wants applied to every NEW project. Written by
-- /user-project-defaults-set, cleared back to NULL by
-- /user-project-defaults-clear. NULL = the user never saved defaults;
-- the webapp then uses the shipped factory defaults
-- (createDefaultSettings). Deliberately no DEFAULT and no backfill —
-- nobody gets a row value they did not save themselves.
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS project_defaults JSONB;
