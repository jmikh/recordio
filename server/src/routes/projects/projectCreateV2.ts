/**
 * POST /project-create-v2 — ports the edge function of the same name
 * (Wave B #12). The TUS resumable upload flow's project-row step.
 *
 * Takes the full project struct, stamps storage paths for whichever
 * media sources exist into it, and upserts the projects row with
 * upload_status='pending'. The client then uploads via Supabase
 * Storage's TUS endpoint (stays on Supabase until Part 4) and calls the
 * client-side `project_confirm_upload` RPC — neither is this route's
 * concern. The only S3 work here is copying default assets (below).
 *
 * Billing revamp Step 4: the caller must be a member of the workspace
 * (verified missing before — any authed user could insert anywhere),
 * and free workspaces enforce the active-project cap: at
 * entitlements.projectCap live projects owned by the caller, creation
 * is refused with 403 { error: 'project_cap_reached', cap }. "Live" =
 * ready, not soft-deleted — the set the dashboard displays; pending
 * rows don't count (an abandoned pending row is invisible in the UI
 * and must not strand users at a phantom cap). The count excludes the
 * id being upserted so retries of the same import never self-block.
 * The 14-day expiry this replaced is gone: expires_at is no longer
 * written (stale values nulled by the Step 4 migration).
 *
 * The `project` body field is the ENTIRE editor project struct —
 * `additionalProperties: true` is load-bearing (Fastify's Ajv strips
 * unknown properties otherwise, which would destroy project_data;
 * pinned by the round-trip test).
 *
 * A project only references files inside its own namespace. A custom
 * background/music coming in from the user's defaults points at their
 * library (or at a project they promoted to defaults), so it is copied
 * into the new project when it sits under the caller's own prefix. When
 * it doesn't, or the copy fails (source gone), it is reset to the plain
 * color / no-music state the editor's clear actions produce — a stale
 * default must never fail an import.
 *
 * Request:  { project, name?, workspaceId }
 * Response: { projectId, slug, bucket, uploads: [{ fileType, storagePath }] }
 *           | 403 { error, cap? }
 * (slug comes from the DB column default — share-access model)
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { isWorkspaceMember } from '../../services/projectAccess.js';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';
import {
    isProjectPath,
    isUserPath,
    projectAssetPath,
    projectMediaPath,
    storageFileName,
} from '../../services/storagePaths.js';
import type { S3Port } from '../../ports/s3.js';

const BUCKET = 'project-media' as const;

/** The slice of the arbitrary project struct this route reads/stamps. */
interface ProjectStruct {
    id: string;
    screenSource?: { storagePath?: string };
    cameraSource?: { storagePath?: string };
    microphoneSource?: { storagePath?: string };
    settings?: {
        background?: { type?: string; storagePath?: string };
        audio?: { music?: { source?: string; enabled?: boolean; storagePath?: string } };
    };
    timeline?: { durationMs?: number };
}

/**
 * Copies `path` into the project when the caller owns it; null when it
 * isn't theirs or the source is gone.
 */
async function copyIntoProject(
    s3: S3Port,
    path: string,
    userId: string,
    projectId: string,
    warn: (obj: object, msg: string) => void,
): Promise<string | null> {
    if (!isUserPath(path, userId)) {
        warn({ path }, 'project-create-v2: asset outside the caller prefix, reset');
        return null;
    }
    const dest = projectAssetPath(userId, projectId, storageFileName(path));
    try {
        await s3.copyObject(path, dest);
        return dest;
    } catch (err) {
        warn({ err, path }, 'project-create-v2: asset copy failed, reset');
        return null;
    }
}

export const projectCreateV2Routes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        '/project-create-v2',
        {
            preHandler: app.requireUser,
            schema: {
                body: Type.Object({
                    project: Type.Object(
                        { id: Type.String({ minLength: 1 }) },
                        { additionalProperties: true },
                    ),
                    name: Type.Optional(Type.String()),
                    workspaceId: Type.String({ minLength: 1 }),
                }),
                response: {
                    200: Type.Object({
                        projectId: Type.String(),
                        slug: Type.String(),
                        bucket: Type.Literal(BUCKET),
                        uploads: Type.Array(
                            Type.Object({
                                fileType: Type.String(),
                                storagePath: Type.String(),
                            }),
                        ),
                    }),
                    400: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    403: Type.Object({
                        error: Type.String(),
                        cap: Type.Optional(Type.Integer()),
                    }),
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req, reply) => {
            const { name, workspaceId } = req.body;
            const project = req.body.project as ProjectStruct;
            const projectId = project.id;
            const userId = req.user!.id;
            req.logCtx.set({ 'project.id': projectId, 'workspace.id': workspaceId });

            if (!await isWorkspaceMember(app.deps.db, workspaceId, userId)) {
                return reply.code(403).send({ error: 'Not a member of this workspace' });
            }

            const entitlements = await getWorkspaceEntitlements(
                app.deps.db,
                app.deps.clock,
                workspaceId,
            );
            if (entitlements.projectCap !== null) {
                const { rows } = await app.deps.db.query(
                    `SELECT COUNT(*)::int AS count FROM projects
                     WHERE workspace_id = $1 AND owner_id = $2
                       AND deleted_at IS NULL AND permanently_deleted = false
                       AND upload_status = 'ready'
                       AND id != $3`,
                    [workspaceId, userId, projectId],
                );
                if ((rows[0] as { count: number }).count >= entitlements.projectCap) {
                    return reply.code(403).send({
                        error: 'project_cap_reached',
                        cap: entitlements.projectCap,
                    });
                }
            }

            // Stamp storage paths into the struct BEFORE the upsert so the
            // stored project_data carries them (edge-fn behavior)
            const uploads: { fileType: string; storagePath: string }[] = [];
            for (const [fileType, key] of [
                ['screen', 'screenSource'],
                ['camera', 'cameraSource'],
                ['mic', 'microphoneSource'],
            ] as const) {
                const source = project[key];
                if (source) {
                    // userId becomes created_by in the upsert below
                    const storagePath = projectMediaPath(userId, projectId, fileType);
                    source.storagePath = storagePath;
                    uploads.push({ fileType, storagePath });
                }
            }

            // Custom background/music from defaults → copies inside the project (see header)
            const warn = (obj: object, msg: string) => req.log.warn({ ...obj, 'project.id': projectId }, msg);
            const background = project.settings?.background;
            if (background?.storagePath && !isProjectPath(background.storagePath, projectId)) {
                const copied = await copyIntoProject(app.deps.s3, background.storagePath, userId, projectId, warn);
                if (copied) {
                    background.storagePath = copied;
                } else {
                    background.type = 'color';
                    delete background.storagePath;
                }
            }
            const music = project.settings?.audio?.music;
            if (music?.storagePath && !isProjectPath(music.storagePath, projectId)) {
                const copied = await copyIntoProject(app.deps.s3, music.storagePath, userId, projectId, warn);
                if (copied) {
                    music.storagePath = copied;
                } else {
                    music.source = 'preset';
                    music.enabled = false;
                    delete music.storagePath;
                }
            }

            // Parity: falsy durationMs (including 0) stores NULL
            const durationMs = project.timeline?.durationMs
                ? Math.round(project.timeline.durationMs)
                : null;

            const { rows: created } = await app.deps.db.query(
                `INSERT INTO projects
                    (id, workspace_id, created_by, owner_id, name, project_data,
                     upload_status, duration_ms)
                 VALUES ($1, $2, $3, $3, $4, $5::jsonb, 'pending', $6)
                 ON CONFLICT (id) DO UPDATE SET
                     workspace_id = EXCLUDED.workspace_id,
                     created_by = EXCLUDED.created_by,
                     owner_id = EXCLUDED.owner_id,
                     name = EXCLUDED.name,
                     project_data = EXCLUDED.project_data,
                     upload_status = EXCLUDED.upload_status,
                     duration_ms = EXCLUDED.duration_ms
                 RETURNING slug`,
                [
                    projectId,
                    workspaceId,
                    userId,
                    name ?? 'Untitled',
                    JSON.stringify(project),
                    durationMs,
                ],
            );

            return {
                projectId,
                slug: (created[0] as { slug: string }).slug,
                bucket: BUCKET,
                uploads,
            };
        },
    );
};
