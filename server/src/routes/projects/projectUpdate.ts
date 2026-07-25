/**
 * POST /project-update — optimistic-concurrency project save
 * (Part 2 Batch 2). Ports the project_update SQL function inline, three
 * paths kept exactly:
 *  1. unchanged project_data (md5 compare IN POSTGRES — jsonb::text
 *     normalization must match the SQL fn's) → update duration/updated_at
 *     only, return the CURRENT version — even when expectedVersion is
 *     stale (pinned: the short-circuit bypasses the version check);
 *  2. expectedVersion given → compare-and-set, cloudVersion null on
 *     conflict (the signal cloudStorage maps to CloudVersionConflictError);
 *  3. no expectedVersion → unconditional update of live projects, no
 *     version bump (SQL parity — only path 2 bumps).
 *
 * Request:  { projectId, projectData, durationMs?, expectedVersion? }
 * Response: { cloudVersion: number | null } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { ProjectUpdateRequestSchema, ProjectUpdateResponseSchema } from '@shared/api/projects';
import { canEditProject } from '../../services/projectAccess.js';

export const projectUpdateRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-update',
        {
            preHandler: app.requireUser,
            schema: {
                // The Ajv null→0 coercion gotcha lives with the schema now —
                // see shared/api/projects.ts (ProjectUpdateRequestSchema)
                body: ProjectUpdateRequestSchema,
                response: {
                    200: ProjectUpdateResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { projectId, projectData } = req.body;
            const durationMs = req.body.durationMs ?? null;
            const expectedVersion = req.body.expectedVersion ?? null;
            const db = app.deps.db;
            req.logCtx.set({ 'project.id': projectId });

            if (!await canEditProject(db, projectId, req.user!.id)) {
                return reply.code(403).send({ error: 'Not an editor of this project' });
            }

            const dataJson = JSON.stringify(projectData);

            const { rows: hashRows } = await db.query(
                `SELECT md5(project_data::text) = md5($2::jsonb::text) AS unchanged
                 FROM projects WHERE id = $1`,
                [projectId, dataJson],
            );

            if ((hashRows[0] as { unchanged: boolean } | undefined)?.unchanged) {
                const { rows } = await db.query(
                    `UPDATE projects
                     SET duration_ms = $2, updated_at = NOW()
                     WHERE id = $1
                     RETURNING cloud_version AS "cloudVersion"`,
                    [projectId, durationMs],
                );
                return { cloudVersion: (rows[0] as { cloudVersion: number }).cloudVersion };
            }

            const { rows } = expectedVersion !== null
                ? await db.query(
                    `UPDATE projects
                     SET project_data  = $2::jsonb,
                         cloud_version = $3 + 1,
                         duration_ms   = $4,
                         updated_at    = NOW()
                     WHERE id = $1
                       AND cloud_version = $3
                     RETURNING cloud_version AS "cloudVersion"`,
                    [projectId, dataJson, expectedVersion, durationMs],
                )
                : await db.query(
                    `UPDATE projects
                     SET project_data = $2::jsonb,
                         duration_ms  = $3,
                         updated_at   = NOW()
                     WHERE id = $1
                       AND deleted_at IS NULL
                     RETURNING cloud_version AS "cloudVersion"`,
                    [projectId, dataJson, durationMs],
                );

            return {
                cloudVersion: (rows[0] as { cloudVersion: number } | undefined)
                    ?.cloudVersion ?? null,
            };
        },
    );
};
