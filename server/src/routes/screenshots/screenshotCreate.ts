/**
 * POST /screenshot-create — the TUS upload flow's row step for
 * screenshots (plans/screenshots, Step 2; sibling of project-create-v2).
 *
 * Takes the full editor document, stamps the source storage path into
 * it, copies the source metadata into the row's columns (so the share
 * page / lists / purge never parse JSON), and upserts the row with
 * upload_status='pending'. The client then TUS-uploads the PNG to the
 * returned path and calls /screenshot-confirm-upload.
 *
 * Caller must be a member of the workspace. Free workspaces enforce the
 * screenshot cap: at entitlements.screenshotCap live screenshots owned
 * by the caller, creation is refused with
 * 403 { error: 'screenshot_cap_reached', cap }. "Live" = ready, not
 * soft-deleted; pending rows don't count and the id being upserted is
 * excluded so retries never self-block (same rules as the project cap).
 *
 * Request:  { screenshot, name?, workspaceId }
 * Response: { screenshotId, slug, bucket, storagePath } | 403 { error, cap? }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { ScreenshotCreateRequestSchema, ScreenshotCreateResponseSchema } from '@shared/api/screenshots';
import { isWorkspaceMember } from '../../services/projectAccess.js';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';
import { screenshotStoragePrefix } from '../../services/screenshotAccess.js';

const BUCKET = 'project-media' as const;

export const screenshotCreateRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/screenshot-create',
        {
            preHandler: app.requireUser,
            schema: {
                body: ScreenshotCreateRequestSchema,
                response: {
                    200: ScreenshotCreateResponseSchema,
                    403: Type.Object({
                        error: Type.String(),
                        cap: Type.Optional(Type.Integer()),
                    }),
                },
            },
        },
        async (req, reply) => {
            const { name, workspaceId, screenshot } = req.body;
            const screenshotId = screenshot.id;
            const userId = req.user!.id;
            req.logCtx.set({ 'screenshot.id': screenshotId, 'workspace.id': workspaceId });

            if (!await isWorkspaceMember(app.deps.db, workspaceId, userId)) {
                return reply.code(403).send({ error: 'Not a member of this workspace' });
            }

            const entitlements = await getWorkspaceEntitlements(
                app.deps.db,
                app.deps.clock,
                workspaceId,
            );
            if (entitlements.screenshotCap !== null) {
                const { rows } = await app.deps.db.query(
                    `SELECT COUNT(*)::int AS count FROM screenshots
                     WHERE workspace_id = $1 AND owner_id = $2
                       AND deleted_at IS NULL AND permanently_deleted = false
                       AND upload_status = 'ready'
                       AND id != $3`,
                    [workspaceId, userId, screenshotId],
                );
                if ((rows[0] as { count: number }).count >= entitlements.screenshotCap) {
                    return reply.code(403).send({
                        error: 'screenshot_cap_reached',
                        cap: entitlements.screenshotCap,
                    });
                }
            }

            // Stamp the storage path into the doc BEFORE the upsert so the
            // stored screenshot_data carries it (same as project-create-v2)
            const storagePath = `${screenshotStoragePrefix(userId, screenshotId)}source.png`;
            const source = screenshot.source as typeof screenshot.source & { storagePath?: string };
            source.storagePath = storagePath;

            const { rows: created } = await app.deps.db.query(
                `INSERT INTO screenshots
                    (id, workspace_id, created_by, owner_id, name, screenshot_data,
                     source_storage_path, width_px, height_px, capture_mode, page_url, page_title,
                     upload_status)
                 VALUES ($1, $2, $3, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, 'pending')
                 ON CONFLICT (id) DO UPDATE SET
                     workspace_id = EXCLUDED.workspace_id,
                     created_by = EXCLUDED.created_by,
                     owner_id = EXCLUDED.owner_id,
                     name = EXCLUDED.name,
                     screenshot_data = EXCLUDED.screenshot_data,
                     source_storage_path = EXCLUDED.source_storage_path,
                     width_px = EXCLUDED.width_px,
                     height_px = EXCLUDED.height_px,
                     capture_mode = EXCLUDED.capture_mode,
                     page_url = EXCLUDED.page_url,
                     page_title = EXCLUDED.page_title,
                     upload_status = EXCLUDED.upload_status
                 RETURNING slug`,
                [
                    screenshotId,
                    workspaceId,
                    userId,
                    name ?? 'Untitled',
                    JSON.stringify(screenshot),
                    storagePath,
                    source.widthPx,
                    source.heightPx,
                    source.captureMode,
                    source.pageUrl ?? null,
                    source.pageTitle ?? null,
                ],
            );

            return {
                screenshotId,
                slug: (created[0] as { slug: string }).slug,
                bucket: BUCKET,
                storagePath,
            };
        },
    );
};
