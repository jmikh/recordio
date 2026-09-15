/**
 * POST /screenshot-update-thumbnail — multipart thumbnail upload
 * (sibling of project-update-thumbnail). Verifies editor access,
 * uploads to S3 and points screenshots.thumbnail_storage_path at it.
 * Check order: 400 missing fields → 413 too large → 404 no access.
 *
 * Unlike the project route, the key is namespaced by the row's
 * created_by (not the caller) so an editor's upload doesn't move the
 * thumbnail to a different prefix than the source/renders.
 *
 * Request:  multipart/form-data { screenshotId, file }
 * Response: { storagePath }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fastifyMultipart from '@fastify/multipart';
import { Type } from '@sinclair/typebox';
import { ScreenshotThumbnailResponseSchema } from '@shared/api/screenshots';
import { getScreenshotIfEditor, screenshotStoragePrefix } from '../../services/screenshotAccess.js';

/** Thumbnails should be small — same cap as the project route */
const MAX_THUMBNAIL_BYTES = 500 * 1024;

export const screenshotUpdateThumbnailRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Scoped to this route module. The fileSize backstop sits above the
    // business cap so the exact 413 body below handles every realistic oversize.
    await app.register(fastifyMultipart, {
        limits: { fileSize: 1024 * 1024, files: 1 },
    });

    app.post(
        '/screenshot-update-thumbnail',
        {
            preHandler: app.requireUser,
            schema: {
                response: {
                    200: ScreenshotThumbnailResponseSchema,
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    404: Type.Object({ error: Type.String() }),
                    413: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            let screenshotId: string | undefined;
            let file: Buffer | undefined;

            for await (const part of req.parts()) {
                if (part.type === 'file') {
                    if (part.fieldname === 'file' && !file) {
                        file = await part.toBuffer();
                    } else {
                        part.file.resume(); // drain unexpected file parts
                    }
                } else if (part.fieldname === 'screenshotId' && typeof part.value === 'string') {
                    screenshotId = part.value;
                }
            }

            if (!screenshotId || !file) {
                return reply.code(400).send({ error: 'Missing screenshotId or file' });
            }

            req.logCtx.set({ 'screenshot.id': screenshotId, 'storage.bytes': file.length });

            if (file.length > MAX_THUMBNAIL_BYTES) {
                return reply.code(413).send({
                    error: `Thumbnail too large: ${file.length} bytes (max ${MAX_THUMBNAIL_BYTES})`,
                });
            }

            const screenshot = await getScreenshotIfEditor(app.deps.db, screenshotId, req.user!.id);
            if (!screenshot) {
                return reply.code(404).send({ error: 'Screenshot not found or access denied' });
            }

            const storagePath = `${screenshotStoragePrefix(screenshot.created_by, screenshotId)}thumbnail.webp`;
            await app.deps.s3.putObject(storagePath, new Uint8Array(file), 'image/webp');

            await app.deps.db.query(
                'UPDATE screenshots SET thumbnail_storage_path = $2 WHERE id = $1',
                [screenshotId, storagePath],
            );

            return { storagePath };
        },
    );
};
