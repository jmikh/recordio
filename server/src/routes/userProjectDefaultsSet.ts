/**
 * POST /user-project-defaults-set — replaces the caller's personal
 * default project settings (plans/user-default-project-settings).
 * Whole-blob replace, never a merge: the webapp always sends the full
 * settings tree together with the project schema version it was
 * written under, so migrateProject can upgrade it later like any
 * project. The settings tree itself is not validated (same posture as
 * project-create-v2's project_data — additionalProperties keeps every
 * key); the body is capped at USER_PROJECT_DEFAULTS_BODY_LIMIT. The
 * upsert covers the no-profile-row edge (the signup trigger normally
 * guarantees one).
 *
 * Request:  { schemaVersion, settings }
 * Response: { saved: true }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { UserProjectDefaultsSetRequestSchema } from '@shared/api/session';

/** A full ProjectSettings tree is ~3 KB; 64 KB leaves room, blocks abuse. */
export const USER_PROJECT_DEFAULTS_BODY_LIMIT = 64 * 1024;

export const userProjectDefaultsSetRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/user-project-defaults-set',
        {
            preHandler: app.requireUser,
            bodyLimit: USER_PROJECT_DEFAULTS_BODY_LIMIT,
            schema: {
                body: UserProjectDefaultsSetRequestSchema,
                response: {
                    200: Type.Object({ saved: Type.Literal(true) }),
                },
            },
        },
        async (req) => {
            const { schemaVersion, settings } = req.body;
            await app.deps.db.query(
                `INSERT INTO user_profiles (user_id, project_defaults, updated_at)
                 VALUES ($1, $2::jsonb, now())
                 ON CONFLICT (user_id) DO UPDATE
                     SET project_defaults = EXCLUDED.project_defaults,
                         updated_at = now()`,
                [req.user!.id, JSON.stringify({ schemaVersion, settings })],
            );
            return { saved: true as const };
        },
    );
};
