/**
 * POST /project-create-v2 — ports the edge function of the same name
 * (Wave B #12). The TUS resumable upload flow's project-row step.
 *
 * Takes the full project struct, stamps storage paths for whichever
 * media sources exist into it, and upserts the projects row with
 * upload_status='pending'. The client then uploads via Supabase
 * Storage's TUS endpoint (stays on Supabase until Part 4) and calls the
 * client-side `project_confirm_upload` RPC — neither is this route's
 * concern. No S3 involvement at all.
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
 * Request:  { project, name?, workspaceId }
 * Response: { projectId, bucket, uploads: [{ fileType, storagePath }] }
 *           | 403 { error, cap? }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { isWorkspaceMember } from '../../services/projectAccess.js';
import { getWorkspaceEntitlements } from '../../services/entitlements.js';

const BUCKET = 'project-media' as const;

const EXT_MAP = {
    screen: 'webm',
    camera: 'webm',
    mic: 'wav',
} as const;

/** The slice of the arbitrary project struct this route reads/stamps. */
interface ProjectStruct {
    id: string;
    screenSource?: { storagePath?: string };
    cameraSource?: { storagePath?: string };
    microphoneSource?: { storagePath?: string };
    timeline?: { durationMs?: number };
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
                    const storagePath = `${userId}/${projectId}/${fileType}.${EXT_MAP[fileType]}`;
                    source.storagePath = storagePath;
                    uploads.push({ fileType, storagePath });
                }
            }

            // Parity: falsy durationMs (including 0) stores NULL
            const durationMs = project.timeline?.durationMs
                ? Math.round(project.timeline.durationMs)
                : null;

            await app.deps.db.query(
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
                     duration_ms = EXCLUDED.duration_ms`,
                [
                    projectId,
                    workspaceId,
                    userId,
                    name ?? 'Untitled',
                    JSON.stringify(project),
                    durationMs,
                ],
            );

            return { projectId, bucket: BUCKET, uploads };
        },
    );
};
