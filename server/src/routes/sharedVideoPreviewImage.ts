/**
 * GET /shared-video-preview-image/:slug — the og:image of a shared
 * video's link preview (plans/share-link-previews-oneshot.md). The first
 * GET route on this server: unfurl bots fetch og:image with a plain GET.
 *
 * ALWAYS 200 image/png, 1200×675:
 *   - public share with a thumbnail → the design-B card built from the
 *     project's editor thumbnail (services/sharePreviewImage.ts);
 *   - anything else (private, workspace, deleted, unknown slug, no
 *     thumbnail yet, S3 or decode failure) → the generic brand card.
 * Never 404s, so a preview never shows a broken image, and the generic
 * card is identical for every slug, so it reveals nothing about one.
 *
 * Cached for an hour: the thumbnail is overwritten in place, and Slack
 * keeps its own copy per unfurl anyway. No response schema — the body is
 * binary.
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { getOutputDurationMs, type ProjectTimelineShape } from '../services/projectCaptions.js';
import { renderGenericPreviewCard, renderVideoPreviewCard } from '../services/sharePreviewImage.js';

const RATE_LIMIT_PER_MINUTE = 60;
const CACHE_CONTROL = 'public, max-age=3600';

interface PreviewImageRow {
    id: string;
    thumbnail_storage_path: string | null;
    timeline: ProjectTimelineShape | null;
}

export const sharedVideoPreviewImageRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        '/shared-video-preview-image/:slug',
        {
            config: {
                rateLimit: { max: RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' },
            },
            schema: {
                params: Type.Object({ slug: Type.String({ minLength: 1 }) }),
            },
        },
        async (req, reply) => {
            const { slug } = req.params;
            req.logCtx.set({ 'project.slug': slug });
            reply.header('content-type', 'image/png').header('cache-control', CACHE_CONTROL);

            const { rows } = await app.deps.db.query(
                `SELECT id, thumbnail_storage_path,
                        jsonb_build_object(
                            'outputWindows', project_data #> '{timeline,outputWindows}'
                        ) AS timeline
                 FROM projects
                 WHERE slug = $1 AND deleted_at IS NULL AND share_policy = 'public'
                 LIMIT 1`,
                [slug],
            );
            const project = rows[0] as PreviewImageRow | undefined;

            if (!project?.thumbnail_storage_path) {
                req.logCtx.set({ 'preview.card': 'generic' });
                return reply.send(await renderGenericPreviewCard());
            }
            req.logCtx.set({ 'project.id': project.id });

            try {
                const thumbnail = await app.deps.s3.getObject(project.thumbnail_storage_path);
                const card = await renderVideoPreviewCard({
                    thumbnail,
                    durationMs: getOutputDurationMs(project.timeline),
                });
                req.logCtx.set({ 'preview.card': 'video' });
                return reply.send(card);
            } catch (err) {
                // A missing or undecodable thumbnail degrades to the brand
                // card — a preview must never be a broken image
                req.log.warn({ err, 'project.id': project.id }, 'shared video preview image fell back to generic card');
                req.logCtx.set({ 'preview.card': 'generic', error_type: 'PreviewImageFailed' });
                return reply.send(await renderGenericPreviewCard());
            }
        },
    );
};
