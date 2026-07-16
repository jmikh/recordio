/**
 * POST /storage-download-urls — ports the edge function of the same name
 * (Wave A #1).
 *
 * Returns presigned S3 GET URLs for files in project-media storage,
 * bypassing the Supabase API proxy. Ownership is enforced by path prefix:
 * every requested path must start with the caller's user id.
 *
 * Request:  { storagePaths: string[] }
 * Response: { signedUrls: Record<string, string> }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

const URL_EXPIRY_SECONDS = 3600;

/**
 * Carried over verbatim from the edge function: this user id may request
 * paths belonging to any user. Flagged in the migration plan as a smell
 * (should become env config) — kept identical during the port.
 */
const ADMIN_USER_ID = '01f290d7-6bfb-4076-8b09-097eca08fc8f';

export const storageDownloadUrlsRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/storage-download-urls',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    storagePaths: Type.Array(Type.String(), { minItems: 1 }),
                }),
                response: {
                    200: Type.Object({
                        signedUrls: Type.Record(Type.String(), Type.String()),
                    }),
                    403: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { storagePaths } = req.body;
            const userId = req.user!.id;
            req.logCtx.set({ 'storage.path_count': storagePaths.length });

            if (userId !== ADMIN_USER_ID) {
                const prefix = `${userId}/`;
                if (storagePaths.some((path) => !path.startsWith(prefix))) {
                    return reply.code(403).send({ error: 'Forbidden' });
                }
            }

            const entries = await Promise.all(
                storagePaths.map(async (path) => {
                    const url = await app.deps.s3.presignDownload(path, URL_EXPIRY_SECONDS);
                    return [path, url] as const;
                }),
            );

            return { signedUrls: Object.fromEntries(entries) };
        },
    );
};
