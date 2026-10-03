/**
 * POST /admin-project-list — the admin page's recent-projects list
 * (plans/admin-user-impersonation-oneshot.md). Admin-only.
 *
 * The 100 most-recently-updated projects that an editor can open
 * (ready, not trashed, not purged), each with its owner and a set of
 * `has_*` flags read straight out of project_data: camera/mic sources
 * present, non-empty caption/zoom/spotlight segment arrays, and any
 * blur overlay. The /admin page shows the flags as icons and a click
 * impersonates the owner straight into that project's editor.
 *
 * The LIMIT runs in a subquery over the bare rows first, so the jsonb
 * is only detoasted and inspected for the rows that make the cut.
 * Every jsonb probe is type-guarded: project_data is arbitrary (old
 * schema versions, test rows with `{}`), and jsonb_array_length on a
 * non-array would error the whole request.
 *
 * Request:  {}
 * Response: { projects: [{ id, name, slug, owner_id, owner_email, owner_name,
 *             created_at, updated_at, duration_ms, has_camera, has_mic,
 *             has_captions, has_zooms, has_spotlights, has_blurs }] }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireAdmin, type AdminRoutesOptions } from './requireAdmin.js';

const RECENT_PROJECTS_LIMIT = 100;

/** SQL: true when the jsonb expression is a non-empty array. */
function nonEmptyArray(expr: string): string {
    return `CASE WHEN jsonb_typeof(${expr}) = 'array' THEN jsonb_array_length(${expr}) > 0 ELSE false END`;
}

/** SQL: true when the jsonb expression is an object (a present source). */
function isObject(expr: string): string {
    return `COALESCE(jsonb_typeof(${expr}) = 'object', false)`;
}

export const adminProjectListRoutes: FastifyPluginAsyncTypebox<AdminRoutesOptions> = async (
    app,
    opts,
) => {
    app.post(
        '/admin-project-list',
        {
            preHandler: [app.requireUser, requireAdmin(opts.adminEmails)],
        },
        async (_req, reply) => {
            const timeline = `p.project_data->'timeline'`;
            const { rows } = await app.deps.db.query(
                `SELECT COALESCE(jsonb_agg(obj ORDER BY updated_at DESC), '[]'::jsonb) AS projects
                 FROM (
                    SELECT p.updated_at,
                           jsonb_build_object(
                        'id',           p.id,
                        'name',         p.name,
                        'slug',         p.slug,
                        'owner_id',     p.owner_id,
                        'owner_email',  u.email,
                        'owner_name',   up.name,
                        'created_at',   p.created_at,
                        'updated_at',   p.updated_at,
                        'duration_ms',  COALESCE(
                            p.duration_ms,
                            CASE WHEN jsonb_typeof(${timeline}->'durationMs') = 'number'
                                 THEN floor((${timeline}->>'durationMs')::numeric)::int END
                        ),
                        'has_camera',     ${isObject(`p.project_data->'cameraSource'`)},
                        'has_mic',        ${isObject(`p.project_data->'microphoneSource'`)},
                        'has_captions',   ${nonEmptyArray(`${timeline}->'captionSegments'`)},
                        'has_zooms',      ${nonEmptyArray(`${timeline}->'zoomSegments'`)},
                        'has_spotlights', ${nonEmptyArray(`${timeline}->'spotlightSegments'`)},
                        'has_blurs',      EXISTS (
                            SELECT 1
                            FROM jsonb_array_elements(
                                CASE WHEN jsonb_typeof(${timeline}->'overlaySegments') = 'array'
                                     THEN ${timeline}->'overlaySegments'
                                     ELSE '[]'::jsonb END
                            ) seg
                            WHERE seg->'item'->>'type' = 'blur'
                        )
                    ) AS obj
                    FROM (
                        SELECT *
                        FROM projects
                        WHERE permanently_deleted = false
                          AND deleted_at IS NULL
                          AND upload_status = 'ready'
                        ORDER BY updated_at DESC
                        LIMIT $1
                    ) p
                    LEFT JOIN auth.users u ON u.id = p.owner_id
                    LEFT JOIN user_profiles up ON up.user_id = p.owner_id
                 ) r`,
                [RECENT_PROJECTS_LIMIT],
            );
            return reply.send({ projects: (rows[0] as { projects: unknown }).projects });
        },
    );
};
