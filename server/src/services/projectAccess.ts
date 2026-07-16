/**
 * Editor-access check — ports `_shared/projectAccess.ts#getProjectIfEditor`.
 * First shared server module: landed with project-update-thumbnail, also
 * needed by mux-video-create and render-job-create when Wave B ports them
 * (the Deno copy stays live for those until then).
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
}

export async function getProjectIfEditor(
    db: Db,
    projectId: string,
    userId: string,
): Promise<ProjectAccess | null> {
    const { rows } = await db.query(
        `SELECT p.id, p.owner_id
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
