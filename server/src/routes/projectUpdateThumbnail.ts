/**
 * POST /project-update-thumbnail — ports the edge function of the same
 * name (Wave A #6, last Wave A route). First multipart route and first
 * direct server-side S3 upload.
 *
 * Accepts multipart/form-data (projectId + an image/webp blob), verifies
 * editor access, uploads to S3 and points projects.thumbnail_storage_path
 * at it. Check order matches the edge fn: 400 missing fields → 413 too
 * large → 404 no access.
 *
 * Parity notes: ContentType is hardcoded image/webp regardless of the
 * actual blob (edge fn did the same); the multipart plugin's own fileSize
 * backstop (1 MB) produces a default-body 413 — the exact edge-fn 413
 * body is kept for the 500 KB business cap underneath it. Divergence: a
 * malformed (non-UUID) projectId 500s here, where the edge fn's
 * getProjectIfEditor swallowed the DB error and returned 404 — no caller
 * sends one (ids come from the app's own records).
 *
 * Request:  multipart/form-data { projectId, file }
 * Response: { storagePath }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fastifyMultipart from '@fastify/multipart';
import { Type } from '@sinclair/typebox';
import { getProjectIfEditor } from '../services/projectAccess.js';

/** Thumbnails should be small — same cap as the edge function */
const MAX_THUMBNAIL_BYTES = 500 * 1024;

export const projectUpdateThumbnailRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Scoped to this route module — the rest of the API is JSON-only.
    // The fileSize backstop sits above the business cap so the exact
    // 413 body below handles every realistic oversize.
    await app.register(fastifyMultipart, {
        limits: { fileSize: 1024 * 1024, files: 1 },
    });

    app.post(
        '/project-update-thumbnail',
        {
            preHandler: app.requireUser,
            schema: {
                // No body schema — TypeBox validation doesn't apply to
                // multipart; field presence is checked in the handler
                response: {
                    200: Type.Object({ storagePath: Type.String() }),
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    404: Type.Object({ error: Type.String() }),
                    413: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            let projectId: string | undefined;
            let file: Buffer | undefined;

            for await (const part of req.parts()) {
                if (part.type === 'file') {
                    if (part.fieldname === 'file' && !file) {
                        file = await part.toBuffer();
                    } else {
                        part.file.resume(); // drain unexpected file parts
                    }
                } else if (part.fieldname === 'projectId' && typeof part.value === 'string') {
                    projectId = part.value;
                }
            }

            if (!projectId || !file) {
                return reply.code(400).send({ error: 'Missing projectId or file' });
            }

            req.logCtx.set({ 'project.id': projectId, 'storage.bytes': file.length });

            if (file.length > MAX_THUMBNAIL_BYTES) {
                return reply.code(413).send({
                    error: `Thumbnail too large: ${file.length} bytes (max ${MAX_THUMBNAIL_BYTES})`,
                });
            }

            const project = await getProjectIfEditor(app.deps.db, projectId, req.user!.id);
            if (!project) {
                return reply.code(404).send({ error: 'Project not found or access denied' });
            }

            const storagePath = `${req.user!.id}/${projectId}/thumbnail.webp`;
            await app.deps.s3.putObject(storagePath, new Uint8Array(file), 'image/webp');

            await app.deps.db.query(
                'UPDATE projects SET thumbnail_storage_path = $2 WHERE id = $1',
                [projectId, storagePath],
            );

            return { storagePath };
        },
    );
};
