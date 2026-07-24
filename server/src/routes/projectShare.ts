/**
 * POST /project-share — creates/updates a project's share slug + policy
 * (Part 2 Batch 2). Ports project_share inline: OWNER-only (editors
 * cannot share — stricter than the editor routes, pinned); generates a
 * 12-hex-char slug on first share, keeps the existing one after; always
 * applies the policy. The old TABLE(slug, is_new) wrapper was an RPC
 * artifact — the response is a plain object (the client used .single()).
 *
 * The SQL fn's 'Invalid share_policy' RAISE is replaced by the schema
 * enum; PT404/PT403 become plain 404/403 with the same messages.
 *
 * Request:  { projectId, sharePolicy? = 'public' }
 * Response: { slug, isNew } | 404 { error } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';

export const projectShareRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-share',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    projectId: Type.String({ minLength: 1 }),
                    sharePolicy: Type.Optional(Type.Union([
                        Type.Literal('public'),
                        Type.Literal('workspace'),
                        Type.Literal('private'),
                    ])),
                }),
                response: {
                    200: Type.Object({
                        slug: Type.String(),
                        isNew: Type.Boolean(),
                    }),
                    403: Type.Object({ error: Type.String() }),
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { projectId } = req.body;
            const sharePolicy = req.body.sharePolicy ?? 'public';
            const db = app.deps.db;
            req.logCtx.set({ 'project.id': projectId });

            const { rows } = await db.query(
                `SELECT slug, owner_id AS "ownerId" FROM projects
                 WHERE id = $1 AND deleted_at IS NULL`,
                [projectId],
            );
            const project = rows[0] as { slug: string | null; ownerId: string } | undefined;

            if (!project) {
                return reply.code(404).send({ error: 'Project not found' });
            }
            if (project.ownerId !== req.user!.id) {
                return reply.code(403).send({ error: 'Only the project owner can share a project' });
            }

            const isNew = project.slug === null;
            const slug = project.slug
                ?? randomUUID().replaceAll('-', '').slice(0, 12);

            await db.query(
                `UPDATE projects
                 SET slug = $2, share_policy = $3, updated_at = NOW()
                 WHERE id = $1`,
                [projectId, slug, sharePolicy],
            );

            req.logCtx.set({ 'project.slug': slug });
            return { slug, isNew };
        },
    );
};
