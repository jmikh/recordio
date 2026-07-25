/**
 * POST /workspace-rename — renames a workspace (Part 2 Batch 3). Ports
 * workspace_rename inline: admin-only; returns the updated blob (the
 * client reads `name` for its toast). The fn's 'Workspace not found'
 * RAISE can't fire here — isWorkspaceAdmin already requires a live
 * workspace, so the UPDATE always matches.
 *
 * Request:  { workspaceId, name }
 * Response: { id, name, owner_id, created_at, updated_at } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { WorkspaceRenameRequestSchema } from '@shared/api/workspaces';
import { isWorkspaceAdmin } from '../services/projectAccess.js';

export const workspaceRenameRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/workspace-rename',
        {
            preHandler: app.requireUser,
            // No response schemas — the 200 is a jsonb blob passthrough
            schema: {
                body: WorkspaceRenameRequestSchema,
            },
        },
        async (req, reply) => {
            const { workspaceId, name } = req.body;
            req.logCtx.set({ 'workspace.id': workspaceId });

            if (!await isWorkspaceAdmin(app.deps.db, workspaceId, req.user!.id)) {
                return reply.code(403).send({ error: 'Requires admin role in this workspace' });
            }

            const { rows } = await app.deps.db.query(
                `UPDATE workspaces
                 SET name = $2, updated_at = now()
                 WHERE id = $1 AND deleted_at IS NULL
                 RETURNING jsonb_build_object(
                    'id',         id,
                    'name',       name,
                    'owner_id',   owner_id,
                    'created_at', created_at,
                    'updated_at', updated_at
                 ) AS workspace`,
                [workspaceId, name],
            );
            return reply.send((rows[0] as { workspace: unknown }).workspace);
        },
    );
};
