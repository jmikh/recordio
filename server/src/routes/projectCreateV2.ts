/**
 * POST /project-create-v2 — ports the edge function of the same name
 * (Wave B #12). The TUS resumable upload flow's project-row step.
 *
 * Takes the full project struct, stamps storage paths for whichever
 * media sources exist into it, decides expiry from the workspace
 * subscription, and upserts the projects row with
 * upload_status='pending'. The client then uploads via Supabase
 * Storage's TUS endpoint (stays on Supabase until Part 4) and calls the
 * client-side `project_confirm_upload` RPC — neither is this route's
 * concern. No S3 involvement at all.
 *
 * (`project-create`, the presigned-PUT v1 sibling, is dead code and is
 * NOT ported — see the migration plan.)
 *
 * Divergences (documented in the migration plan): the per-field 400
 * bodies (`Missing workspaceId`, `Missing project or project.id`) are
 * replaced by Fastify schema-validation 400s; a malformed non-UUID
 * project/workspace id 500s at the pg cast (edge fn parity differs only
 * in error shape — PostgREST also errored).
 *
 * The `project` body field is the ENTIRE editor project struct —
 * `additionalProperties: true` is load-bearing (Fastify's Ajv strips
 * unknown properties otherwise, which would destroy project_data;
 * pinned by the round-trip test).
 *
 * Request:  { project, name?, workspaceId }
 * Response: { projectId, bucket, uploads: [{ fileType, storagePath }] }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';

const BUCKET = 'project-media' as const;

const EXT_MAP = {
    screen: 'webm',
    camera: 'webm',
    mic: 'wav',
} as const;

const EXPIRY_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for non-subscribed workspaces

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
                    500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                },
            },
        },
        async (req) => {
            const { name, workspaceId } = req.body;
            const project = req.body.project as ProjectStruct;
            const projectId = project.id;
            const userId = req.user!.id;
            req.logCtx.set({ 'project.id': projectId, 'workspace.id': workspaceId });

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

            // Subscribed (active or past_due) workspaces keep projects
            // forever; everything else expires in 14 days
            const { rows } = await app.deps.db.query(
                'SELECT status FROM subscriptions WHERE workspace_id = $1',
                [workspaceId],
            );
            const status = (rows[0] as { status: string } | undefined)?.status;
            const hasActiveSub = status === 'active' || status === 'past_due';
            const expiresAt = hasActiveSub
                ? null
                : new Date(app.deps.clock.now().getTime() + EXPIRY_MS).toISOString();

            // Parity: falsy durationMs (including 0) stores NULL
            const durationMs = project.timeline?.durationMs
                ? Math.round(project.timeline.durationMs)
                : null;

            await app.deps.db.query(
                `INSERT INTO projects
                    (id, workspace_id, created_by, owner_id, name, project_data,
                     upload_status, duration_ms, expires_at)
                 VALUES ($1, $2, $3, $3, $4, $5::jsonb, 'pending', $6, $7)
                 ON CONFLICT (id) DO UPDATE SET
                     workspace_id = EXCLUDED.workspace_id,
                     created_by = EXCLUDED.created_by,
                     owner_id = EXCLUDED.owner_id,
                     name = EXCLUDED.name,
                     project_data = EXCLUDED.project_data,
                     upload_status = EXCLUDED.upload_status,
                     duration_ms = EXCLUDED.duration_ms,
                     expires_at = EXCLUDED.expires_at`,
                [
                    projectId,
                    workspaceId,
                    userId,
                    name ?? 'Untitled',
                    JSON.stringify(project),
                    durationMs,
                    expiresAt,
                ],
            );

            return { projectId, bucket: BUCKET, uploads };
        },
    );
};
