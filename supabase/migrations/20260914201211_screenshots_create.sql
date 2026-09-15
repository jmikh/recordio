-- Screenshots sub-product (plans/screenshots/screenshots-tiered-plan.md, Step 1).
--
-- Screenshots are their own entity, deliberately NOT a kind of project:
-- a separate table with the proven project patterns (permanent share
-- slug from a DB default, share policy + workspace access level,
-- optimistic concurrency on cloud_version, soft delete + purge job).
-- No per-user editor grants in v1 (policy-only sharing), so there is no
-- screenshot_editors table.
--
-- screenshot_data holds the editor document (crop, annotations,
-- defaults). Source metadata is duplicated into columns so server
-- routes (share page, lists, purge) never parse the JSON.
--
-- RLS is enabled with no policies: the anon key cannot read this table;
-- every access goes through the Fastify server (current practice for
-- all public tables since the edge-function decommission).

CREATE TABLE IF NOT EXISTS public.screenshots (
    id                     uuid PRIMARY KEY,
    created_by             uuid NOT NULL,
    owner_id               uuid NOT NULL,
    workspace_id           uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name                   text NOT NULL DEFAULT 'Untitled',
    screenshot_data        jsonb NOT NULL,
    source_storage_path    text NOT NULL,
    width_px               integer NOT NULL CHECK (width_px > 0),
    height_px              integer NOT NULL CHECK (height_px > 0),
    capture_mode           text NOT NULL CHECK (capture_mode IN ('visible', 'fullPage', 'region')),
    page_url               text,
    page_title             text,
    thumbnail_storage_path text,
    upload_status          text NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'ready')),
    cloud_version          integer NOT NULL DEFAULT 1,
    slug                   text NOT NULL UNIQUE DEFAULT left(replace(gen_random_uuid()::text, '-', ''), 12),
    share_policy           text NOT NULL DEFAULT 'private' CHECK (share_policy IN ('private', 'workspace', 'public')),
    workspace_access       text NOT NULL DEFAULT 'view' CHECK (workspace_access IN ('view', 'edit')),
    render_storage_path    text,
    render_cloud_version   integer,
    last_accessed_at       timestamptz NOT NULL DEFAULT now(),
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    deleted_at             timestamptz,
    permanently_deleted    boolean NOT NULL DEFAULT false
);

-- screenshot-list is scoped by workspace; the purge job scans deleted_at.
CREATE INDEX IF NOT EXISTS screenshots_workspace_idx
    ON public.screenshots (workspace_id)
    WHERE permanently_deleted = false;

CREATE INDEX IF NOT EXISTS screenshots_deleted_at_idx
    ON public.screenshots (deleted_at)
    WHERE deleted_at IS NOT NULL AND permanently_deleted = false;

ALTER TABLE public.screenshots ENABLE ROW LEVEL SECURITY;
