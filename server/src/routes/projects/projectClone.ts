/**
 * POST /project-clone — copies a project into the ADMIN's default
 * workspace, media and all. Reachable only from inside an impersonation
 * session (requireImpersonatingAdmin): the bearer is the target user's
 * minted token, so `req.user` is whose project is being cloned, and the
 * token's `impersonated_by` claim is who receives the copy. That gate is
 * the only thing making this admin-only — if cloning ever becomes a user
 * feature, swap the preHandler and pick a destination workspace from the
 * body; nothing else here is impersonation-specific.
 *
 * What gets copied:
 *   - the project_data blob verbatim, except `id` and every storagePath
 *     in it (paths are referenced FROM the blob — see below);
 *   - every media object the blob points at: screen/camera/mic plus a
 *     custom background/music asset, server-side S3 copies (the bytes
 *     never enter this process);
 *   - the thumbnail, best-effort — a missing one is cosmetic.
 *
 * Why the paths must be rewritten and not just pointed at: storage
 * ownership is by path prefix (`${userId}/…`, enforced by
 * /storage-download-urls), so a clone still pointing at the original
 * owner's objects would 403 for the admin on load. Media lands under
 * `${adminId}/${newProjectId}/` — the same prefix the purge job deletes
 * when the clone is deleted, assets included, so the copy owns its bytes
 * and the original's deletion can't gut it.
 *
 * What is deliberately NOT copied: share policy/slug (the row gets fresh
 * DB defaults), editor grants, render jobs and Mux videos (the clone
 * renders itself on demand). The free-plan project cap is not enforced
 * either — this is an internal admin tool.
 *
 * Request:  { projectId } | { slug }
 * Response: { projectId, slug, workspaceId, name }
 *           | 400 { error } | 403 { error } | 404 { error }
 */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import { ProjectCloneRequestSchema, ProjectCloneResponseSchema } from '@shared/api/projects';
import { requireImpersonatingAdmin, type AdminRoutesOptions } from '../admin/requireAdmin.js';
import { canViewProject } from '../../services/projectAccess.js';
import { resolveDefaultWorkspaceId } from '../../services/defaultWorkspace.js';

/** The slice of the arbitrary project struct this route rewrites. */
interface ProjectStruct {
    id?: string;
    screenSource?: { storagePath?: string };
    cameraSource?: { storagePath?: string };
    microphoneSource?: { storagePath?: string };
    settings?: {
        background?: { storagePath?: string };
        audio?: { music?: { storagePath?: string } };
    };
}

type MediaSlot = 'screen' | 'camera' | 'mic' | 'background' | 'music';

interface ProjectRow {
    id: string;
    name: string;
    created_by: string;
    owner_id: string;
    project_data: ProjectStruct;
    duration_ms: number | null;
    thumbnail_storage_path: string | null;
    upload_status: string;
}

/**
 * Where a slot's copy lands. Recording media keeps its canonical
 * `${slot}.${ext}` name (what the editor and render worker expect);
 * library assets (background/music) keep their filename under an
 * `assets/` subfolder, so two of them can't collide.
 */
function destinationPath(slot: MediaSlot, sourcePath: string, prefix: string): string {
    const fileName = sourcePath.split('/').pop() ?? slot;
    if (slot === 'background' || slot === 'music') return `${prefix}assets/${fileName}`;
    const ext = fileName.includes('.') ? fileName.split('.').pop()! : 'bin';
    return `${prefix}${slot}.${ext}`;
}

export const projectCloneRoutes: FastifyPluginAsyncTypebox<AdminRoutesOptions> =
    async (app, opts) => {
        app.post(
            '/project-clone',
            {
                preHandler: [app.requireUser, requireImpersonatingAdmin(opts.adminEmails)],
                schema: {
                    body: ProjectCloneRequestSchema,
                    response: {
                        200: ProjectCloneResponseSchema,
                        400: Type.Object({ error: Type.String() }),
                        403: Type.Object({ error: Type.String() }),
                        404: Type.Object({ error: Type.String() }),
                        500: Type.Object({ error: Type.String() }, { additionalProperties: true }),
                    },
                },
            },
            async (req, reply) => {
                const viewerId = req.user!.id;
                const adminId = req.user!.impersonatedBy!;
                const db = app.deps.db;

                if (!req.body.projectId && !req.body.slug) {
                    return reply.code(400).send({ error: 'projectId or slug required' });
                }

                const { rows } = await db.query(
                    `SELECT id, name, created_by, owner_id, project_data, duration_ms,
                            thumbnail_storage_path, upload_status
                     FROM projects
                     WHERE deleted_at IS NULL
                       AND ($1::text IS NULL OR id::text = $1)
                       AND ($2::text IS NULL OR slug = $2)`,
                    [req.body.projectId ?? null, req.body.slug ?? null],
                );
                const source = rows[0] as ProjectRow | undefined;
                if (!source) return reply.code(404).send({ error: 'Project not found' });
                // The admin's id is already on the canonical event as
                // impersonated_by (the auth plugin's audit trail)
                req.logCtx.set({ 'project.id': source.id });

                // The admin sees this project through the impersonated user's
                // eyes — clone only what that user may actually open
                if (!await canViewProject(db, source.id, viewerId)) {
                    return reply.code(403).send({ error: 'Not allowed to view this project' });
                }
                if (source.upload_status !== 'ready') {
                    return reply.code(400).send({ error: 'Project media is still uploading' });
                }

                const workspaceId = await resolveDefaultWorkspaceId(db, adminId);
                if (!workspaceId) {
                    req.log.error({ 'user.id': adminId }, 'admin owns no workspace to clone into');
                    return reply.code(500).send({ error: 'No workspace for the admin account' });
                }

                const newProjectId = randomUUID();
                const prefix = `${adminId}/${newProjectId}/`;
                const data = source.project_data ?? {};
                data.id = newProjectId;

                // Rewriting in place: the row object is this handler's own,
                // and project_data is large enough (userEvents) that cloning
                // it just to mutate would double the footprint for nothing.
                const slots: { slot: MediaSlot; path?: string; set: (p: string) => void }[] = [
                    { slot: 'screen', path: data.screenSource?.storagePath, set: p => { data.screenSource!.storagePath = p; } },
                    { slot: 'camera', path: data.cameraSource?.storagePath, set: p => { data.cameraSource!.storagePath = p; } },
                    { slot: 'mic', path: data.microphoneSource?.storagePath, set: p => { data.microphoneSource!.storagePath = p; } },
                    { slot: 'background', path: data.settings?.background?.storagePath, set: p => { data.settings!.background!.storagePath = p; } },
                    { slot: 'music', path: data.settings?.audio?.music?.storagePath, set: p => { data.settings!.audio!.music!.storagePath = p; } },
                ];

                const copied: string[] = [];
                try {
                    for (const { slot, path, set } of slots) {
                        if (!path) continue;
                        const dest = destinationPath(slot, path, prefix);
                        await app.deps.s3.copyObject(path, dest);
                        copied.push(dest);
                        set(dest);
                    }
                } catch (err) {
                    await app.deps.s3.deleteObjects(copied).catch(() => {});
                    req.log.error({ err, 'project.id': source.id }, 'project clone: media copy failed');
                    return reply.code(500).send({ error: 'Failed to copy project media' });
                }

                // Cosmetic: a project whose thumbnail object is missing (or
                // never uploaded) still clones fine, just without a card image
                let thumbnailPath: string | null = null;
                if (source.thumbnail_storage_path) {
                    const dest = `${prefix}thumbnail.webp`;
                    try {
                        await app.deps.s3.copyObject(source.thumbnail_storage_path, dest);
                        copied.push(dest);
                        thumbnailPath = dest;
                    } catch (err) {
                        req.log.warn({ err, 'project.id': source.id }, 'project clone: thumbnail copy failed');
                    }
                }

                const name = `${source.name} (clone)`;
                let slug: string;
                try {
                    const { rows: created } = await db.query(
                        `INSERT INTO projects
                            (id, workspace_id, created_by, owner_id, name, project_data,
                             upload_status, duration_ms, thumbnail_storage_path)
                         VALUES ($1, $2, $3, $3, $4, $5::jsonb, 'ready', $6, $7)
                         RETURNING slug`,
                        [
                            newProjectId,
                            workspaceId,
                            adminId,
                            name,
                            JSON.stringify(data),
                            source.duration_ms,
                            thumbnailPath,
                        ],
                    );
                    slug = (created[0] as { slug: string }).slug;
                } catch (err) {
                    // Don't strand the copies: without the row nothing will
                    // ever reference or purge them
                    await app.deps.s3.deleteObjects(copied).catch(() => {});
                    throw err;
                }

                req.log.info(
                    {
                        admin_id: adminId,
                        source_project_id: source.id,
                        source_owner_id: source.owner_id,
                        clone_project_id: newProjectId,
                        workspace_id: workspaceId,
                    },
                    'admin cloned a project while impersonating',
                );

                return { projectId: newProjectId, slug, workspaceId, name };
            },
        );
    };
