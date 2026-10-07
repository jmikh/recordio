/**
 * POST /project-asset-attach — copies one of the caller's library assets
 * (background/music) into a project they can edit, returning the copy's
 * key for project_data and a presigned GET for it.
 *
 * A project only references files inside its own namespace: project-get
 * signs those for every editor, and project-update rejects anything else.
 * So picking a library asset in the editor attaches a copy instead of
 * pointing at the library, and collaborators can load it. The copy keeps
 * the asset's file name (re-attaching overwrites the same key), is
 * deleted with the project by the purge job, and survives the library
 * asset's deletion.
 *
 * Request:  { projectId, assetId }
 * Response: { storagePath, downloadUrl } | 404 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { ProjectAssetAttachRequestSchema, ProjectAssetAttachResponseSchema } from '@shared/api/projects';
import { getProjectIfEditor } from '../../services/projectAccess.js';
import { DOWNLOAD_URL_TTL_SECONDS } from '../../services/downloadUrls.js';
import { projectAssetPath, storageFileName } from '../../services/storagePaths.js';

export const projectAssetAttachRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-asset-attach',
        {
            preHandler: app.requireUser,
            schema: {
                body: ProjectAssetAttachRequestSchema,
                response: {
                    200: ProjectAssetAttachResponseSchema,
                    404: Type.Object({ error: Type.String() }),
                },
            },
        },
        async (req, reply) => {
            const { projectId, assetId } = req.body;
            const userId = req.user!.id;
            req.logCtx.set({ 'project.id': projectId, 'asset.id': assetId });

            const project = await getProjectIfEditor(app.deps.db, projectId, userId);
            if (!project) {
                return reply.code(404).send({ error: 'Project not found or access denied' });
            }

            // Only the caller's own library — the same filter asset-list signs by
            const { rows } = await app.deps.db.query(
                `SELECT storage_path AS "storagePath"
                 FROM user_assets
                 WHERE id = $1 AND user_id = $2
                   AND status = 'ready' AND is_deleted = false`,
                [assetId, userId],
            );
            const source = (rows[0] as { storagePath: string } | undefined)?.storagePath;
            if (!source) {
                return reply.code(404).send({ error: 'Asset not found' });
            }

            const storagePath = projectAssetPath(project.created_by, projectId, storageFileName(source));
            await app.deps.s3.copyObject(source, storagePath);

            return {
                storagePath,
                downloadUrl: await app.deps.s3.presignDownload(storagePath, DOWNLOAD_URL_TTL_SECONDS),
            };
        },
    );
};
