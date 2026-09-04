/**
 * POST /project-editor-set — grants (or updates) an individual member's
 * access to a project (share-access model). OWNER-only, same strictness
 * as project-share. The target must be a live member of the project's
 * workspace — individual shares are workspace-internal (no external
 * emails) — and viewer-role members cannot be granted 'edit' (their
 * seats are free/view-only; seat-billing guard). Granting access IS
 * sharing, so the canShare entitlement gates it (un-sharing via
 * project-editor-remove is never gated).
 *
 * Request:  { projectId, userId, role: 'view' | 'edit' }
 * Response: { editors } | 400 { error } | 403 { error } | 404 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
    ProjectEditorSetRequestSchema,
    ProjectEditorsResponseSchema,
} from '@shared/api/projects';
import { isWorkspaceMember, listProjectEditors } from '../../services/projectAccess.js';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';

export const projectEditorSetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-editor-set',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectEditorSetRequestSchema,
                response: {
                    200: ProjectEditorsResponseSchema,
                    400: Type.Object({ error: Type.String() }),
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { projectId, userId, role } = req.body;
            const db = app.deps.db;
            req.logCtx.set({ 'project.id': projectId });

            const { rows } = await db.query(
                `SELECT owner_id AS "ownerId", workspace_id AS "workspaceId"
                 FROM projects
                 WHERE id = $1 AND deleted_at IS NULL`,
                [projectId],
            );
            const project = rows[0] as
                | { ownerId: string; workspaceId: string }
                | undefined;

            if (!project) {
                return reply.code(404).send({ error: 'Project not found' });
            }
            if (project.ownerId !== req.user!.id) {
                return reply.code(403).send({ error: 'Only the project owner can manage project sharing' });
            }
            if (userId === project.ownerId) {
                return reply.code(400).send({ error: 'Owner already has access' });
            }
            if (!await isWorkspaceMember(db, project.workspaceId, userId)) {
                return reply.code(400).send({ error: 'User is not a member of this workspace' });
            }
            if (role === 'edit') {
                // Seat-billing guard: viewer-role members hold free
                // view-only seats — edit grants would bypass creator
                // seats. (The workspace owner has no member row and
                // counts as admin.)
                const { rows: memberRows } = await db.query(
                    'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
                    [project.workspaceId, userId],
                );
                if ((memberRows[0] as { role: string } | undefined)?.role === 'viewer') {
                    return reply.code(400).send({ error: 'Viewers cannot be granted edit access' });
                }
            }

            const entitlements = await getWorkspaceEntitlements(
                db,
                app.deps.clock,
                project.workspaceId,
            );
            if (!entitlements.canShare) {
                return reply.code(403).send({ error: 'subscription_required' });
            }

            await db.query(
                `INSERT INTO project_editors (project_id, user_id, role)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
                [projectId, userId, role],
            );

            return { editors: await listProjectEditors(db, projectId) };
        },
    );
};
