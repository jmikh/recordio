/**
 * POST /asset-upload — single-request replacement (2026-07-24) for the
 * three-step presign flow (/asset-create → signed PUT → the
 * asset_confirm_upload RPC, now dropped — see sql/graveyard.sql). The
 * presign dance existed for the edge functions' request-size limits;
 * the Fastify server has none that matter at these caps.
 *
 * Accepts multipart/form-data (assetType + file), validates the caps
 * against the ACTUAL bytes (the presigned PUT never enforced the
 * client-declared sizeBytes), uploads to S3 server-side, and inserts
 * the user_assets row directly as 'ready' — no pending state left in
 * the flow.
 *
 * Contract kept from /asset-create: library_full returns the rich body
 * with status 200 (the shape the client's AssetLibraryFullError branch
 * is written against); the extension and size-cap 400 bodies are
 * unchanged.
 *
 * Compensating cleanup: if the insert fails after the S3 put, the
 * object is deleted before rethrowing so it doesn't orphan.
 *
 * Request:  multipart/form-data { assetType: 'background' | 'music', file }
 * Response: { assetId, storagePath }
 *         | { error: 'library_full', message, count, limit }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fastifyMultipart from '@fastify/multipart';
import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';

const LIBRARY_LIMIT = 10; // per asset type per user

/** Max file sizes per type */
const MAX_SIZE = {
    background: 25 * 1024 * 1024, // 25 MB
    music: 50 * 1024 * 1024, // 50 MB
} as const;

/** Allowed extensions per type */
const ALLOWED_EXT = {
    background: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
    music: ['mp3', 'wav', 'aac', 'm4a', 'ogg'],
} as const;

/** S3 ContentType per allowed extension (ext is validated before lookup) */
const CONTENT_TYPE: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', avif: 'image/avif',
    mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
    m4a: 'audio/mp4', ogg: 'audio/ogg',
};

export const assetUploadRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Scoped to this route module. The fileSize backstop sits just above
    // the largest business cap so the exact 400 body below handles every
    // realistic oversize; past the backstop it's a default-body 413.
    await app.register(fastifyMultipart, {
        limits: { fileSize: MAX_SIZE.music + 1024, files: 1 },
    });

    app.post(
        '/asset-upload',
        {
            preHandler: app.requireUser,
            schema: {
                // No body schema — TypeBox validation doesn't apply to
                // multipart; field presence is checked in the handler
                response: {
                    200: Type.Union([
                        Type.Object({
                            assetId: Type.String(),
                            storagePath: Type.String(),
                        }),
                        Type.Object({
                            error: Type.Literal('library_full'),
                            message: Type.String(),
                            count: Type.Number(),
                            limit: Type.Number(),
                        }),
                    ]),
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    413: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            const userId = req.user!.id;

            let assetType: string | undefined;
            let fileName: string | undefined;
            let file: Buffer | undefined;

            for await (const part of req.parts()) {
                if (part.type === 'file') {
                    if (part.fieldname === 'file' && !file) {
                        fileName = part.filename;
                        file = await part.toBuffer();
                    } else {
                        part.file.resume(); // drain unexpected file parts
                    }
                } else if (part.fieldname === 'assetType' && typeof part.value === 'string') {
                    assetType = part.value;
                }
            }

            if ((assetType !== 'background' && assetType !== 'music') || !file || !fileName) {
                return reply.code(400).send({ error: 'Missing or invalid assetType or file' });
            }

            req.logCtx.set({ 'asset.type': assetType, 'storage.bytes': file.length });

            const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
            if (!(ALLOWED_EXT[assetType] as readonly string[]).includes(ext)) {
                return reply.code(400).send({
                    error: `Invalid file type ".${ext}" for ${assetType}. Allowed: ${ALLOWED_EXT[assetType].join(', ')}`,
                });
            }

            if (file.length > MAX_SIZE[assetType]) {
                const maxMB = MAX_SIZE[assetType] / (1024 * 1024);
                return reply.code(400).send({
                    error: `File too large. Max ${maxMB} MB for ${assetType}`,
                });
            }

            const { rows } = await app.deps.db.query(
                `SELECT COUNT(*)::int AS count
                 FROM user_assets
                 WHERE user_id = $1
                   AND asset_type = $2
                   AND status = 'ready'
                   AND is_deleted = false`,
                [userId, assetType],
            );
            const count = (rows[0] as { count: number }).count;

            if (count >= LIBRARY_LIMIT) {
                return {
                    error: 'library_full' as const,
                    message: `Library full (${LIBRARY_LIMIT}/${LIBRARY_LIMIT}). Delete an asset to upload a new one.`,
                    count,
                    limit: LIBRARY_LIMIT,
                };
            }

            const assetId = randomUUID();
            const storagePath = `${userId}/assets/${assetId}.${ext}`;

            await app.deps.s3.putObject(storagePath, new Uint8Array(file), CONTENT_TYPE[ext]);

            try {
                await app.deps.db.query(
                    `INSERT INTO user_assets
                        (id, user_id, asset_type, storage_path, name, size_bytes, status)
                     VALUES ($1, $2, $3, $4, $5, $6, 'ready')`,
                    [assetId, userId, assetType, storagePath, fileName, file.length],
                );
            } catch (err) {
                await app.deps.s3.deleteObjects([storagePath]);
                throw err;
            }

            return { assetId, storagePath };
        },
    );
};
