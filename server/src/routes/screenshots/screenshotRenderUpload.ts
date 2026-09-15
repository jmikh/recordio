/**
 * POST /screenshot-render-upload — stores the FLATTENED PNG (source +
 * annotations, blur applied) that the public share page serves. The
 * raw source is never exposed publicly, so the editor must publish a
 * render before a link shows anything (plans/screenshots).
 *
 * The render is keyed by the cloud_version it was rendered from:
 * `{created_by}/screenshots/{id}/renders/v{cloudVersion}.png`. The
 * client sends the version it rendered; if the row has moved on
 * (another editor saved) the upload is refused with 409
 * { error: 'version_mismatch' } so the client re-renders after its
 * pending save — checked cheaply BEFORE the S3 put, and again as a
 * compare-and-set on the UPDATE (a lost race after the put deletes the
 * orphaned object). The previous render is deleted best-effort.
 *
 * Check order: 400 missing/invalid fields → 413 too large → 404 no
 * access → 409 stale version.
 *
 * Request:  multipart/form-data { screenshotId, cloudVersion, file }
 * Response: { storagePath, renderCloudVersion }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fastifyMultipart from '@fastify/multipart';
import { Type } from '@sinclair/typebox';
import { ScreenshotRenderUploadResponseSchema } from '@shared/api/screenshots';
import { getScreenshotIfEditor, screenshotStoragePrefix } from '../../services/screenshotAccess.js';

/** Flattened PNGs of full-page captures can be large; 25 MB matches the asset upload cap. */
export const MAX_RENDER_BYTES = 25 * 1024 * 1024;

export const screenshotRenderUploadRoutes: FastifyPluginAsyncTypebox = async (app) => {
    await app.register(fastifyMultipart, {
        limits: { fileSize: MAX_RENDER_BYTES + 1024, files: 1 },
    });

    app.post(
        '/screenshot-render-upload',
        {
            preHandler: app.requireUser,
            schema: {
                response: {
                    200: ScreenshotRenderUploadResponseSchema,
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    404: Type.Object({ error: Type.String() }),
                    409: Type.Object({ error: Type.String() }),
                    413: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            let screenshotId: string | undefined;
            let cloudVersionRaw: string | undefined;
            let file: Buffer | undefined;

            for await (const part of req.parts()) {
                if (part.type === 'file') {
                    if (part.fieldname === 'file' && !file) {
                        file = await part.toBuffer();
                    } else {
                        part.file.resume();
                    }
                } else if (typeof part.value === 'string') {
                    if (part.fieldname === 'screenshotId') screenshotId = part.value;
                    else if (part.fieldname === 'cloudVersion') cloudVersionRaw = part.value;
                }
            }

            const cloudVersion = cloudVersionRaw !== undefined ? Number(cloudVersionRaw) : NaN;
            if (!screenshotId || !file || !Number.isInteger(cloudVersion) || cloudVersion < 1) {
                return reply.code(400).send({ error: 'Missing screenshotId, cloudVersion or file' });
            }

            req.logCtx.set({
                'screenshot.id': screenshotId,
                'screenshot.render_version': cloudVersion,
                'storage.bytes': file.length,
            });

            if (file.length > MAX_RENDER_BYTES) {
                return reply.code(413).send({
                    error: `Render too large: ${file.length} bytes (max ${MAX_RENDER_BYTES})`,
                });
            }

            const screenshot = await getScreenshotIfEditor(app.deps.db, screenshotId, req.user!.id);
            if (!screenshot) {
                return reply.code(404).send({ error: 'Screenshot not found or access denied' });
            }
            if (screenshot.cloud_version !== cloudVersion) {
                return reply.code(409).send({ error: 'version_mismatch' });
            }

            const storagePath =
                `${screenshotStoragePrefix(screenshot.created_by, screenshotId)}renders/v${cloudVersion}.png`;
            await app.deps.s3.putObject(storagePath, new Uint8Array(file), 'image/png');

            const { rowCount } = await app.deps.db.query(
                `UPDATE screenshots
                 SET render_storage_path = $2, render_cloud_version = $3
                 WHERE id = $1 AND cloud_version = $3`,
                [screenshotId, storagePath, cloudVersion],
            );
            if ((rowCount ?? 0) === 0) {
                // Lost the race between the access check and the put
                await app.deps.s3.deleteObjects([storagePath]);
                return reply.code(409).send({ error: 'version_mismatch' });
            }

            const previous = screenshot.render_storage_path;
            if (previous && previous !== storagePath) {
                // Best-effort: a leaked old render is harmless and the purge
                // job deletes the whole prefix eventually
                await app.deps.s3.deleteObjects([previous]).catch(() => undefined);
            }

            return { storagePath, renderCloudVersion: cloudVersion };
        },
    );
};
