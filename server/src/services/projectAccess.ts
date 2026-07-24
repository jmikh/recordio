/**
 * Editor-access check — ports `_shared/projectAccess.ts#getProjectIfEditor`.
 * First shared server module: landed with project-update-thumbnail; also
 * used by render-job-create and mux-video-create (all Wave B routes are
 * ported — the Deno copy dies at decommission).
 *
 * Access = the project exists, is not soft-deleted, and the user is its
 * owner OR has an explicit project_editors row. Returns null otherwise —
 * "not found" and "no access" are deliberately indistinguishable (the edge
 * fn behaves the same; both surface as one 404).
 *
 * The edge fn's two queries (project fetch, then editors lookup) collapse
 * into one EXISTS — same observable result.
 */
import type { Db } from '../deps.js';

export interface ProjectAccess {
    id: string;
    owner_id: string;
    /** Share slug — null until project_share creates one (mux-video-create gates on it) */
    slug: string | null;
}

export async function getProjectIfEditor(
    db: Db,
    projectId: string,
    userId: string,
): Promise<ProjectAccess | null> {
    const { rows } = await db.query(
        `SELECT p.id, p.owner_id, p.slug
         FROM projects p
         WHERE p.id = $1
           AND p.deleted_at IS NULL
           AND (
               p.owner_id = $2
               OR EXISTS (
                   SELECT 1 FROM project_editors pe
                   WHERE pe.project_id = p.id AND pe.user_id = $2
               )
           )
         LIMIT 1`,
        [projectId, userId],
    );
    return (rows[0] as ProjectAccess | undefined) ?? null;
}

/**
 * Ports `assert_project_editor` for the Part 2 route ports: editor access
 * (owner OR project_editors row) on a live project in a live workspace.
 * Stricter than getProjectIfEditor above — the SQL assert also rejects
 * projects whose WORKSPACE is soft-deleted, which the edge-fn-era helper
 * never checked (kept separate so Part 1 routes keep their verified
 * behavior).
 */
export async function canEditProject(
    db: Db,
    projectId: string,
    userId: string,
): Promise<boolean> {
    const { rows } = await db.query(
        `SELECT 1
         FROM projects p
         LEFT JOIN workspaces w ON w.id = p.workspace_id
         WHERE p.id = $1
           AND p.deleted_at IS NULL
           AND (p.workspace_id IS NULL OR w.deleted_at IS NULL)
           AND (
               p.owner_id = $2
               OR EXISTS (
                   SELECT 1 FROM project_editors pe
                   WHERE pe.project_id = p.id AND pe.user_id = $2
               )
           )
         LIMIT 1`,
        [projectId, userId],
    );
    return rows.length > 0;
}

/** Ports `assert_workspace_viewer`: member (any role) of a live workspace. */
export async function isWorkspaceMember(
    db: Db,
    workspaceId: string,
    userId: string,
): Promise<boolean> {
    const { rows } = await db.query(
        `SELECT 1
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.workspace_id = $1
           AND wm.user_id = $2
           AND w.deleted_at IS NULL
         LIMIT 1`,
        [workspaceId, userId],
    );
    return rows.length > 0;
}
