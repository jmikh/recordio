/**
 * "Which workspace is this user's default?" — extracted from
 * /workspace-get-default when /project-clone needed the same answer for
 * a user who is NOT the caller (the admin behind an impersonation).
 *
 * Resolution order (unchanged from the route):
 *   1. the stored user_profiles.default_workspace_id, if that workspace
 *      is still live AND the user still owns it or is a member;
 *   2. else their oldest owned live workspace.
 * null = the user owns no workspace at all, which the signup bootstrap
 * (on_user_signup_bootstrap) makes impossible — callers treat it as an
 * invariant violation, not a normal branch.
 *
 * Healing the stored default stays in the route: it is a side effect of
 * the session bootstrap, not of resolving someone else's workspace.
 */
import type { Db } from '../deps.js';

export async function resolveDefaultWorkspaceId(
    db: Db,
    userId: string,
): Promise<string | null> {
    // Owners have no workspace_members row — ownership is its own state
    const { rows: storedRows } = await db.query(
        `SELECT w.id
         FROM user_profiles up
         JOIN workspaces w ON w.id = up.default_workspace_id
         WHERE up.user_id = $1
           AND w.deleted_at IS NULL
           AND (
               w.owner_id = $1
               OR EXISTS (
                   SELECT 1 FROM workspace_members wm
                   WHERE wm.workspace_id = w.id AND wm.user_id = $1
               )
           )`,
        [userId],
    );
    const stored = (storedRows[0] as { id: string } | undefined)?.id;
    if (stored) return stored;

    const { rows } = await db.query(
        `SELECT w.id
         FROM workspaces w
         WHERE w.owner_id = $1 AND w.deleted_at IS NULL
         ORDER BY w.created_at ASC
         LIMIT 1`,
        [userId],
    );
    return (rows[0] as { id: string } | undefined)?.id ?? null;
}
