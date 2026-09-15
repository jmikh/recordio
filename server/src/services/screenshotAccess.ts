/**
 * Screenshot access checks (plans/screenshots, Step 2) — the screenshot
 * counterpart of projectAccess.ts. Screenshots have NO per-user grants
 * in v1 (policy-only sharing), so the SQL is the project version minus
 * the editors-table clauses.
 *
 * Edit access = owner, OR a non-viewer workspace member when the
 * screenshot is shared to the workspace with edit access
 * (share_policy workspace/public + workspace_access 'edit'). Workspace
 * member = workspaces.owner_id or a workspace_members row (owners have
 * no member row). Viewer-role members are excluded (seat-billing guard,
 * same as projects).
 *
 * Every check requires a live screenshot (deleted_at IS NULL) in a live
 * workspace. "Not found" and "no access" are deliberately
 * indistinguishable — callers surface one 404/403.
 */
import type { Db } from '../deps.js';

export interface ScreenshotAccess {
    id: string;
    owner_id: string;
    /** Storage prefix owner — every object of this screenshot lives under `${created_by}/screenshots/${id}/` */
    created_by: string;
    slug: string;
    workspace_id: string;
    cloud_version: number;
    render_storage_path: string | null;
}

const EDIT_ACCESS_SQL = `
    s.owner_id = $2
    OR (
        s.share_policy IN ('workspace', 'public')
        AND s.workspace_access = 'edit'
        AND (
            w.owner_id = $2
            OR EXISTS (
                SELECT 1 FROM workspace_members wm
                WHERE wm.workspace_id = s.workspace_id AND wm.user_id = $2
                  AND wm.role != 'viewer'
            )
        )
    )
`;

export async function getScreenshotIfEditor(
    db: Db,
    screenshotId: string,
    userId: string,
): Promise<ScreenshotAccess | null> {
    const { rows } = await db.query(
        `SELECT s.id, s.owner_id, s.created_by, s.slug, s.workspace_id, s.cloud_version, s.render_storage_path
         FROM screenshots s
         LEFT JOIN workspaces w ON w.id = s.workspace_id
         WHERE s.id = $1
           AND s.deleted_at IS NULL
           AND w.deleted_at IS NULL
           AND (${EDIT_ACCESS_SQL})
         LIMIT 1`,
        [screenshotId, userId],
    );
    return (rows[0] as ScreenshotAccess | undefined) ?? null;
}

export async function canEditScreenshot(
    db: Db,
    screenshotId: string,
    userId: string,
): Promise<boolean> {
    return (await getScreenshotIfEditor(db, screenshotId, userId)) !== null;
}

/**
 * View access for a SIGNED-IN user (the anonymous public-policy case is
 * handled at the route): public → anyone; owner → always; workspace
 * policy → any member of the live workspace.
 */
export async function canViewScreenshot(
    db: Db,
    screenshotId: string,
    userId: string,
): Promise<boolean> {
    const { rows } = await db.query(
        `SELECT 1
         FROM screenshots s
         LEFT JOIN workspaces w ON w.id = s.workspace_id
         WHERE s.id = $1
           AND s.deleted_at IS NULL
           AND w.deleted_at IS NULL
           AND (
               s.share_policy = 'public'
               OR s.owner_id = $2
               OR (
                   s.share_policy = 'workspace'
                   AND (
                       w.owner_id = $2
                       OR EXISTS (
                           SELECT 1 FROM workspace_members wm
                           WHERE wm.workspace_id = s.workspace_id AND wm.user_id = $2
                       )
                   )
               )
           )
         LIMIT 1`,
        [screenshotId, userId],
    );
    return rows.length > 0;
}

/** Storage prefix every object of a screenshot lives under (source, thumbnail, renders). */
export function screenshotStoragePrefix(createdBy: string, screenshotId: string): string {
    return `${createdBy}/screenshots/${screenshotId}/`;
}
