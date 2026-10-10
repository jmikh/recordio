/**
 * POST /shared-video-preview — link-unfurl metadata for a shared video
 * (plans/share-link-previews-oneshot.md). Called by the Cloudflare Pages
 * Function functions/video/[slug].ts, which injects it into the SPA shell
 * as og:/twitter: tags so Slack, iMessage etc. show a rich card.
 *
 * NO auth: a preview is the anonymous view by definition. PUBLIC shares
 * only — private, workspace, deleted and unknown slugs all get the same
 * 404, so a crawler can't tell a private video from a missing one and a
 * private title never reaches a preview.
 *
 * Side-effect free, unlike /shared-video-get: a crawler hit must never
 * dispatch a render or spend the publish budget.
 *
 * Rate limit: every caller is the Pages Function, i.e. a handful of
 * shared Cloudflare egress IPs, on ordinary page views as well as
 * crawler hits — so it sits at the global ceiling rather than
 * shared-video-get's 60. The function edge-caches each slug for 60s.
 *
 * Request:  { slug }
 * Response: { name, ownerName, durationMs? } | 404 { error: 'not_found' }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { SharedVideoPreviewRequestSchema, SharedVideoPreviewResponseSchema } from '@shared/api/projects';
import { getOutputDurationMs, type ProjectTimelineShape } from '../services/projectTimeline.js';
import { ownerDisplayName } from '../services/ownerDisplayName.js';

const RATE_LIMIT_PER_MINUTE = 300;

interface PreviewRow {
    id: string;
    name: string;
    owner_id: string;
    timeline: ProjectTimelineShape | null;
}

export const sharedVideoPreviewRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/shared-video-preview',
        {
            config: {
                rateLimit: { max: RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
            },
            schema: {
                body: SharedVideoPreviewRequestSchema,
                response: {
                    200: SharedVideoPreviewResponseSchema,
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { slug } = req.body;
            req.logCtx.set({ 'project.slug': slug });

            // Only the outputWindows path — never the whole jsonb
            // (userEvents can be megabytes)
            const { rows } = await app.deps.db.query(
                `SELECT id, name, owner_id,
                        jsonb_build_object(
                            'outputWindows', project_data #> '{timeline,outputWindows}'
                        ) AS timeline
                 FROM projects
                 WHERE slug = $1 AND deleted_at IS NULL AND share_policy = 'public'
                 LIMIT 1`,
                [slug],
            );
            const project = rows[0] as PreviewRow | undefined;
            if (!project) {
                return reply.code(404).send({ error: 'not_found' });
            }
            req.logCtx.set({ 'project.id': project.id });

            const owner = await app.deps.supabaseApi.getUserById(project.owner_id).catch(() => {
                req.logCtx.set({ error_type: 'SupabaseApiUnavailable' });
                return null;
            });
            const durationMs = getOutputDurationMs(project.timeline);

            return {
                name: project.name,
                ownerName: ownerDisplayName(owner),
                // Key omitted when the timeline has no usable windows
                ...(durationMs !== undefined && { durationMs }),
            };
        },
    );
};
