/**
 * Editor-access check — ports `_shared/projectAccess.ts#getProjectIfEditor`.
 * First shared server module: landed with project-update-thumbnail; also
 * used by render-job-create and mux-video-create (all Wave B routes are
 * ported — the Deno copy dies at decommission).
 *
 * Access = the project exists, is not soft-deleted, and the user has
 * edit access (see EDIT_ACCESS_SQL — owner, edit-role grant, or
 * workspace-edit share). Returns null otherwise — "not found" and "no
 * access" are deliberately indistinguishable (the edge fn behaves the
 * same; both surface as one 404).
 *
 * The edge fn's two queries (project fetch, then editors lookup) collapse
 * into one EXISTS — same observable result.
 */
import type { Db } from '../deps.js';
import type { ProjectEditor } from '@shared/api/projects';

export interface ProjectAccess {
    id: string;
    owner_id: string;
    /** Permanent share slug (NOT NULL + DB default since the share-access migration) */
    slug: string;
    workspace_id: string;
}

/**
 * Edit access (share-access model) = owner, OR an explicit
 * project_editors row with role 'edit', OR a non-viewer workspace
 * member when the project is shared to the workspace with edit access
 * (share_policy workspace/public + workspace_access 'edit').
 * Workspace member = workspaces.owner_id or a workspace_members row
 * (owners have no member row — revamp Step 2). Viewer-role members are
 * excluded: viewer seats are free/view-only by design, so workspace-
 * edit sharing must not hand them edit rights (seat-billing guard).
 */
const EDIT_ACCESS_SQL = `
    p.owner_id = $2
    OR EXISTS (
        SELECT 1 FROM project_editors pe
        WHERE pe.project_id = p.id AND pe.user_id = $2 AND pe.role = 'edit'
    )
    OR (
        p.share_policy IN ('workspace', 'public')
        AND p.workspace_access = 'edit'
        AND (
            w.owner_id = $2
            OR EXISTS (
                SELECT 1 FROM workspace_members wm
                WHERE wm.workspace_id = p.workspace_id AND wm.user_id = $2
                  AND wm.role != 'viewer'
            )
        )
    )
`;

export async function getProjectIfEditor(
    db: Db,
    projectId: string,
    userId: string,
): Promise<ProjectAccess | null> {
    const { rows } = await db.query(
        `SELECT p.id, p.owner_id, p.slug, p.workspace_id
         FROM projects p
         LEFT JOIN workspaces w ON w.id = p.workspace_id
         WHERE p.id = $1
           AND p.deleted_at IS NULL
           AND (${EDIT_ACCESS_SQL})
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
           AND (${EDIT_ACCESS_SQL})
         LIMIT 1`,
        [projectId, userId],
    );
    return rows.length > 0;
}

/**
 * View access for a SIGNED-IN user (the anonymous public-policy case is
 * handled at the route): public → anyone; owner or any project_editors
 * row (either role) → always; workspace policy → any member of a live
 * workspace.
 */
export async function canViewProject(
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
               p.share_policy = 'public'
               OR p.owner_id = $2
               OR EXISTS (
                   SELECT 1 FROM project_editors pe
                   WHERE pe.project_id = p.id AND pe.user_id = $2
               )
               OR (
                   p.share_policy = 'workspace'
                   AND (
                       w.owner_id = $2
                       OR EXISTS (
                           SELECT 1 FROM workspace_members wm
                           WHERE wm.workspace_id = p.workspace_id AND wm.user_id = $2
                       )
                   )
               )
           )
         LIMIT 1`,
        [projectId, userId],
    );
    return rows.length > 0;
}

/**
 * The project's individual grants in the wire shape project-get and the
 * grant routes share (auth.users email + user_profiles name join).
 */
export async function listProjectEditors(
    db: Db,
    projectId: string,
): Promise<ProjectEditor[]> {
    const { rows } = await db.query(
        `SELECT pe.user_id, u.email, up.name, pe.role
         FROM project_editors pe
         JOIN auth.users u ON u.id = pe.user_id
         LEFT JOIN user_profiles up ON up.user_id = pe.user_id
         WHERE pe.project_id = $1
         ORDER BY pe.created_at`,
        [projectId],
    );
    return rows as ProjectEditor[];
}

/**
 * Ports `assert_workspace_admin`: the owner (owner is its own state —
 * workspaces.owner_id implies admin, revamp Step 2) or an admin member
 * of a live workspace.
 */
export async function isWorkspaceAdmin(
    db: Db,
    workspaceId: string,
    userId: string,
): Promise<boolean> {
    const { rows } = await db.query(
        `SELECT 1
         FROM workspaces w
         WHERE w.id = $1
           AND w.deleted_at IS NULL
           AND (
               w.owner_id = $2
               OR EXISTS (
                   SELECT 1 FROM workspace_members wm
                   WHERE wm.workspace_id = w.id
                     AND wm.user_id = $2
                     AND wm.role = 'admin'
               )
           )
         LIMIT 1`,
        [workspaceId, userId],
    );
    return rows.length > 0;
}

/**
 * Ports `assert_workspace_viewer`: the owner or a member (any role) of
 * a live workspace. Owners have no workspace_members row (revamp Step 2
 * — the table holds invited members only).
 */
export async function isWorkspaceMember(
    db: Db,
    workspaceId: string,
    userId: string,
): Promise<boolean> {
    const { rows } = await db.query(
        `SELECT 1
         FROM workspaces w
         WHERE w.id = $1
           AND w.deleted_at IS NULL
           AND (
               w.owner_id = $2
               OR EXISTS (
                   SELECT 1 FROM workspace_members wm
                   WHERE wm.workspace_id = w.id AND wm.user_id = $2
               )
           )
         LIMIT 1`,
        [workspaceId, userId],
    );
    return rows.length > 0;
}
