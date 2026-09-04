/**
 * POST /project-share — updates a project's share policy + workspace
 * access level. OWNER-only (editors cannot share — stricter than the
 * editor routes, pinned). Slugs are permanent since the share-access
 * migration (DB default at insert), so this route no longer creates
 * them; the generation fallback stays for pre-migration rows only.
 *
 * Share links are trial/Pro: the workspace's entitlements must have
 * canShare — EXCEPT for sharePolicy 'private', which is always allowed
 * (an expired-trial owner must be able to un-share a public video).
 *
 * Omitted sharePolicy means 'public' (wire compat with the pre-modal
 * Publish button); omitted workspaceAccess keeps the current level.
 *
 * Override rule (confirmed design): a policy granting the workspace
 * view (workspace/public + access=view) deletes individual 'view'
 * grants; workspace access 'edit' deletes ALL individual grants — the
 * broad grant subsumes them. Setting private deletes nothing. The
 * UPDATE and the conditional DELETE run as one atomic CTE statement
 * (the pooled db has no transaction surface — see
 * workspaceInviteAccept.ts).
 *
 * Request:  { projectId, sharePolicy? = 'public', workspaceAccess? }
 * Response: { slug, isNew } | 404 { error } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import { ProjectShareRequestSchema, ProjectShareResponseSchema } from '@shared/api/projects';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';

export const projectShareRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-share',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectShareRequestSchema,
                response: {
                    200: ProjectShareResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { projectId, workspaceAccess } = req.body;
            const sharePolicy = req.body.sharePolicy ?? 'public';
            const db = app.deps.db;
            req.logCtx.set({ 'project.id': projectId });

            const { rows } = await db.query(
                `SELECT slug, owner_id AS "ownerId", workspace_id AS "workspaceId"
                 FROM projects
                 WHERE id = $1 AND deleted_at IS NULL`,
                [projectId],
            );
            const project = rows[0] as
                | { slug: string | null; ownerId: string; workspaceId: string }
                | undefined;

            if (!project) {
                return reply.code(404).send({ error: 'Project not found' });
            }
            if (project.ownerId !== req.user!.id) {
                return reply.code(403).send({ error: 'Only the project owner can share a project' });
            }

            if (sharePolicy !== 'private') {
                const entitlements = await getWorkspaceEntitlements(
                    db,
                    app.deps.clock,
                    project.workspaceId,
                );
                if (!entitlements.canShare) {
                    return reply.code(403).send({ error: 'subscription_required' });
                }
            }

            const isNew = project.slug === null;
            const slug = project.slug
                ?? randomUUID().replaceAll('-', '').slice(0, 12);

            // Update + override-rule delete in one atomic statement: a
            // policy granting the workspace view erases individual view
            // grants; workspace access 'edit' erases all grants.
            const { rows: removed } = await db.query(
                `WITH updated AS (
                    UPDATE projects
                    SET slug = $2,
                        share_policy = $3,
                        workspace_access = COALESCE($4, workspace_access),
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING id, share_policy, workspace_access
                )
                DELETE FROM project_editors pe
                USING updated u
                WHERE pe.project_id = u.id
                  AND u.share_policy IN ('workspace', 'public')
                  AND (u.workspace_access = 'edit' OR pe.role = 'view')
                RETURNING pe.user_id`,
                [projectId, slug, sharePolicy, workspaceAccess ?? null],
            );

            req.logCtx.set({
                'project.slug': slug,
                'share.policy': sharePolicy,
                'share.removed_editors': removed.length,
            });
            return { slug, isNew };
        },
    );
};
