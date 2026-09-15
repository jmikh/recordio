/**
 * POST /screenshot-update — optimistic-concurrency save of the editor
 * document (sibling of project-update). Three paths:
 *  1. unchanged screenshot_data (md5 compare in Postgres) → return the
 *     CURRENT version, no write at all (a no-op save must not reorder
 *     the dashboard — the project route's updated_at bump is a parity
 *     leftover we don't carry over);
 *  2. expectedVersion given → compare-and-set, cloudVersion null on
 *     conflict (the signal the client maps to CloudVersionConflictError);
 *  3. no expectedVersion → unconditional update of live screenshots,
 *     no version bump.
 *
 * Request:  { screenshotId, screenshotData, expectedVersion? }
 * Response: { cloudVersion: number | null } | 403 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { ScreenshotUpdateRequestSchema, ScreenshotUpdateResponseSchema } from '@shared/api/screenshots';
import { canEditScreenshot } from '../../services/screenshotAccess.js';

export const screenshotUpdateRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/screenshot-update',
        {
            preHandler: app.requireUser,
            schema: {
                body: ScreenshotUpdateRequestSchema,
                response: {
                    200: ScreenshotUpdateResponseSchema,
                    403: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { screenshotId, screenshotData } = req.body;
            const expectedVersion = req.body.expectedVersion ?? null;
            const db = app.deps.db;
            req.logCtx.set({ 'screenshot.id': screenshotId });

            if (!await canEditScreenshot(db, screenshotId, req.user!.id)) {
                return reply.code(403).send({ error: 'Not an editor of this screenshot' });
            }

            const dataJson = JSON.stringify(screenshotData);

            const { rows: hashRows } = await db.query(
                `SELECT cloud_version AS "cloudVersion",
                        md5(screenshot_data::text) = md5($2::jsonb::text) AS unchanged
                 FROM screenshots WHERE id = $1`,
                [screenshotId, dataJson],
            );
            const current = hashRows[0] as { cloudVersion: number; unchanged: boolean } | undefined;
            if (current?.unchanged) {
                return { cloudVersion: current.cloudVersion };
            }

            const { rows } = expectedVersion !== null
                ? await db.query(
                    `UPDATE screenshots
                     SET screenshot_data = $2::jsonb,
                         cloud_version   = $3 + 1,
                         updated_at      = NOW()
                     WHERE id = $1
                       AND cloud_version = $3
                     RETURNING cloud_version AS "cloudVersion"`,
                    [screenshotId, dataJson, expectedVersion],
                )
                : await db.query(
                    `UPDATE screenshots
                     SET screenshot_data = $2::jsonb,
                         updated_at      = NOW()
                     WHERE id = $1
                       AND deleted_at IS NULL
                     RETURNING cloud_version AS "cloudVersion"`,
                    [screenshotId, dataJson],
                );

            return {
                cloudVersion: (rows[0] as { cloudVersion: number } | undefined)
                    ?.cloudVersion ?? null,
            };
        },
    );
};
