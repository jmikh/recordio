/**
 * Client↔server contract for the project routes
 * (plans/shared-api-contract.md). The schema objects here ARE the
 * server's runtime validation — server/src/routes/projects/*.ts import
 * them verbatim — and the webapp's compile-time types via ApiRoutes
 * (./index). Pure schemas + types: this folder imports nothing from
 * server/ or webapp/.
 *
 * CloudProject / CloudProjectSummary are plain interfaces, not TypeBox:
 * the server deliberately serializes project-get / project-list without
 * a response schema (arbitrary project_data jsonb must not be stripped
 * by fast-json-stringify), so a schema here would be pretend-validation.
 * They mirror the routes' jsonb_build_object field lists exactly —
 * snake_case, as the wire shape kept at the Batch 2 cutover.
 */
import { Type, type Static } from '@sinclair/typebox';

export const SharePolicySchema = Type.Union([
    Type.Literal('public'),
    Type.Literal('workspace'),
    Type.Literal('private'),
]);
export type SharePolicy = Static<typeof SharePolicySchema>;

/**
 * Shared request body of project-get / project-delete / project-restore /
 * project-confirm-upload (identical inline objects before this file).
 */
export const ProjectIdRequestSchema = Type.Object({
    projectId: Type.String({ minLength: 1 }),
});
export type ProjectIdRequest = Static<typeof ProjectIdRequestSchema>;

// ── POST /project-get ────────────────────────────────────────────

export interface ProjectEditor {
    user_id: string;
    email: string;
    name: string | null;
}

/** Full project row as project-get sends it (response: CloudProject | null). */
export interface CloudProject {
    id: string;
    name: string;
    created_by: string;
    owner_id: string;
    workspace_id: string | null;
    project_data: unknown;
    cloud_version: number;
    upload_status: string;
    last_accessed_at: string;
    updated_at: string;
    created_at: string;
    expires_at: string | null;
    thumbnail_storage_path: string | null;
    slug: string | null;
    share_policy: SharePolicy;
    is_shared: boolean;
    editors: ProjectEditor[];
}

// ── POST /project-list ───────────────────────────────────────────

export const ProjectListRequestSchema = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
});
export type ProjectListRequest = Static<typeof ProjectListRequestSchema>;

/** Summary row as project-list sends it — lightweight, no project_data. */
export interface CloudProjectSummary {
    id: string;
    name: string;
    created_by: string;
    owner_id: string;
    workspace_id: string;
    thumbnail_storage_path: string | null;
    last_accessed_at: string;
    updated_at: string;
    created_at: string;
    expires_at: string | null;
    deleted_at: string | null;
    cloud_version: number;
    duration_ms: number | null;
    slug: string | null;
    share_policy: SharePolicy;
    is_shared: boolean;
}

export interface ProjectListResponse {
    projects: CloudProjectSummary[];
}

// ── POST /project-update ─────────────────────────────────────────

// Omittable ints are Optional, NEVER Union([Integer, Null]): Ajv's
// coerceTypes turns a JSON null into 0 via the integer branch (found
// the hard way — a null expectedVersion became a compare-and-set
// against version 0). Clients omit the key instead of sending null.
export const ProjectUpdateRequestSchema = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    projectData: Type.Unknown(),
    durationMs: Type.Optional(Type.Integer()),
    expectedVersion: Type.Optional(Type.Integer()),
});
export type ProjectUpdateRequest = Static<typeof ProjectUpdateRequestSchema>;

/** cloudVersion null = version conflict (client maps it to CloudVersionConflictError). */
export const ProjectUpdateResponseSchema = Type.Object({
    cloudVersion: Type.Union([Type.Integer(), Type.Null()]),
});
export type ProjectUpdateResponse = Static<typeof ProjectUpdateResponseSchema>;

// ── POST /project-update-name + /project-rename (identical twins) ─

export const ProjectNameUpdateRequestSchema = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    name: Type.String(),
});
export type ProjectNameUpdateRequest = Static<typeof ProjectNameUpdateRequestSchema>;

export const ProjectNameUpdateResponseSchema = Type.Object({
    ok: Type.Literal(true),
});
export type ProjectNameUpdateResponse = Static<typeof ProjectNameUpdateResponseSchema>;

// ── POST /project-share ──────────────────────────────────────────

export const ProjectShareRequestSchema = Type.Object({
    projectId: Type.String({ minLength: 1 }),
    sharePolicy: Type.Optional(SharePolicySchema),
});
export type ProjectShareRequest = Static<typeof ProjectShareRequestSchema>;

export const ProjectShareResponseSchema = Type.Object({
    slug: Type.String(),
    isNew: Type.Boolean(),
});
export type ProjectShareResponse = Static<typeof ProjectShareResponseSchema>;

// ── POST /project-delete / -restore / -confirm-upload ────────────

export const ProjectDeleteResponseSchema = Type.Object({
    deleted: Type.Boolean(),
});
export type ProjectDeleteResponse = Static<typeof ProjectDeleteResponseSchema>;

export const ProjectRestoreResponseSchema = Type.Object({
    restored: Type.Boolean(),
});
export type ProjectRestoreResponse = Static<typeof ProjectRestoreResponseSchema>;

export const ProjectConfirmUploadResponseSchema = Type.Object({
    confirmed: Type.Boolean(),
});
export type ProjectConfirmUploadResponse = Static<typeof ProjectConfirmUploadResponseSchema>;
