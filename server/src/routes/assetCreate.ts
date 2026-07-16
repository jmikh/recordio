/**
 * POST /asset-create — ports the edge function of the same name
 * (Wave B #7, first Wave B route).
 *
 * Creates a pending user_assets row and returns a presigned S3 PUT. The
 * client uploads directly, then calls the asset_confirm_upload RPC
 * (client-called SQL — untouched by the migration) to flip the row to
 * 'ready'.
 *
 * DELIBERATE FIX (user decision 2026-07-16), not parity: the edge fn
 * returned the rich library-full body with status 403, but
 * supabase.functions.invoke surfaces non-2xx as data:null + a generic
 * error, so the client's AssetLibraryFullError branch (keyed on
 * data?.error === 'library_full') was dead code. This route returns the
 * SAME body with status 200 — the contract the client was written for —
 * so the existing branch works with zero client changes. The flag-off /
 * edge-fn path keeps the old broken-generic behavior until cutover.
 *
 * Other divergence (same as all waves): the per-field 400 bodies are
 * replaced by Fastify schema-validation 400s; the cross-field extension
 * and size-cap checks keep their exact edge-fn bodies.
 *
 * Compensating cleanup (first route with the pattern): if presigning
 * throws after the insert, the pending row is deleted before rethrowing
 * so it doesn't linger.
 *
 * Request:  { assetType: 'background' | 'music', sizeBytes, fileName }
 * Response: { signedUrl, storagePath, assetId }
 *         | { error: 'library_full', message, count, limit }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
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

const PRESIGN_EXPIRY_SECONDS = 3600;

export const assetCreateRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/asset-create',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    assetType: Type.Union([Type.Literal('background'), Type.Literal('music')]),
                    fileName: Type.String({ minLength: 1 }),
                    sizeBytes: Type.Number({ exclusiveMinimum: 0 }),
                }),
                response: {
                    200: Type.Union([
                        Type.Object({
                            signedUrl: Type.String(),
                            storagePath: Type.String(),
                            assetId: Type.String(),
                        }),
                        Type.Object({
                            error: Type.Literal('library_full'),
                            message: Type.String(),
                            count: Type.Number(),
                            limit: Type.Number(),
                        }),
                    ]),
                    // additionalProperties keeps Fastify's default
                    // validation-400 body intact while the business 400s
                    // send exact `{ error }` edge-fn bodies
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            const { assetType, fileName, sizeBytes } = req.body;
            const userId = req.user!.id;
            req.logCtx.set({ 'asset.type': assetType, 'storage.bytes': sizeBytes });

            const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
            if (!(ALLOWED_EXT[assetType] as readonly string[]).includes(ext)) {
                return reply.code(400).send({
                    error: `Invalid file type ".${ext}" for ${assetType}. Allowed: ${ALLOWED_EXT[assetType].join(', ')}`,
                });
            }

            if (sizeBytes > MAX_SIZE[assetType]) {
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
                // FIX: 200 instead of the edge fn's 403 — see header comment
                return {
                    error: 'library_full' as const,
                    message: `Library full (${LIBRARY_LIMIT}/${LIBRARY_LIMIT}). Delete an asset to upload a new one.`,
                    count,
                    limit: LIBRARY_LIMIT,
                };
            }

            const assetId = randomUUID();
            const storagePath = `${userId}/assets/${assetId}.${ext}`;

            await app.deps.db.query(
                `INSERT INTO user_assets
                    (id, user_id, asset_type, storage_path, name, size_bytes, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
                [assetId, userId, assetType, storagePath, fileName, sizeBytes],
            );

            // Compensating cleanup: don't leave a pending row pointing at a
            // key the client can never upload to
            try {
                const signedUrl = await app.deps.s3.presignUpload(storagePath, PRESIGN_EXPIRY_SECONDS);
                return { signedUrl, storagePath, assetId };
            } catch (err) {
                await app.deps.db.query('DELETE FROM user_assets WHERE id = $1', [assetId]);
                throw err;
            }
        },
    );
};
