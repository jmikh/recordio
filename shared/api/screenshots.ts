/**
 * Client↔server contract for the screenshot routes
 * (plans/screenshots/screenshots-tiered-plan.md). Same conventions as
 * ./projects: the TypeBox schemas ARE the server's runtime validation
 * (server/src/routes/screenshots/*.ts import them verbatim) and the
 * webapp's compile-time types via ApiRoutes (./index).
 *
 * CloudScreenshot / CloudScreenshotSummary are plain interfaces: the
 * routes serialize them without a response schema so the arbitrary
 * screenshot_data jsonb isn't stripped. They mirror the routes'
 * jsonb_build_object field lists exactly — snake_case on the wire.
 *
 * Multipart routes (screenshot-update-thumbnail, screenshot-render-upload)
 * carry no request schema here; only their JSON responses are typed.
 */
import { Type, type Static } from '@sinclair/typebox';
import { AccessRoleSchema, SharePolicySchema, type AccessRole, type SharePolicy } from './projects';

export const ScreenshotCaptureModeSchema = Type.Union([
    Type.Literal('visible'),
    Type.Literal('fullPage'),
    Type.Literal('region'),
]);

/** Shared body of screenshot-delete / -restore / -confirm-upload. */
export const ScreenshotIdRequestSchema = Type.Object({
    screenshotId: Type.String({ minLength: 1 }),
});
export type ScreenshotIdRequest = Static<typeof ScreenshotIdRequestSchema>;

// ── POST /screenshot-create ──────────────────────────────────────

/**
 * `screenshot` is the ENTIRE editor document (ScreenshotDoc) —
 * additionalProperties: true is load-bearing (Ajv strips unknown keys
 * otherwise). The route reads `id` and `source` and stamps
 * `source.storagePath`; the source columns are copied from `source`.
 */
export const ScreenshotCreateRequestSchema = Type.Object({
    screenshot: Type.Object(
        {
            id: Type.String({ minLength: 1 }),
            source: Type.Object(
                {
                    widthPx: Type.Integer({ minimum: 1 }),
                    heightPx: Type.Integer({ minimum: 1 }),
                    devicePixelRatio: Type.Number({ minimum: 0 }),
                    captureMode: ScreenshotCaptureModeSchema,
                    pageUrl: Type.Optional(Type.String()),
                    pageTitle: Type.Optional(Type.String()),
                },
                { additionalProperties: true },
            ),
        },
        { additionalProperties: true },
    ),
    name: Type.Optional(Type.String()),
    workspaceId: Type.String({ minLength: 1 }),
});
export type ScreenshotCreateRequest = Static<typeof ScreenshotCreateRequestSchema>;

export const ScreenshotCreateResponseSchema = Type.Object({
    screenshotId: Type.String(),
    slug: Type.String(),
    bucket: Type.Literal('project-media'),
    /** Where the client TUS-uploads the source PNG */
    storagePath: Type.String(),
});
export type ScreenshotCreateResponse = Static<typeof ScreenshotCreateResponseSchema>;

// ── POST /screenshot-get ─────────────────────────────────────────

/** Resolves by id OR by slug (the /screenshot/{slug}/edit route); exactly one required. */
export const ScreenshotGetRequestSchema = Type.Object({
    screenshotId: Type.Optional(Type.String({ minLength: 1 })),
    slug: Type.Optional(Type.String({ minLength: 1 })),
});
export type ScreenshotGetRequest = Static<typeof ScreenshotGetRequestSchema>;

/** Full screenshot row as screenshot-get sends it (response: CloudScreenshot | null). */
export interface CloudScreenshot {
    id: string;
    name: string;
    created_by: string;
    owner_id: string;
    workspace_id: string;
    screenshot_data: unknown;
    source_storage_path: string;
    width_px: number;
    height_px: number;
    capture_mode: 'visible' | 'fullPage' | 'region';
    page_url: string | null;
    page_title: string | null;
    thumbnail_storage_path: string | null;
    upload_status: string;
    cloud_version: number;
    slug: string;
    share_policy: SharePolicy;
    workspace_access: AccessRole;
    is_shared: boolean;
    render_storage_path: string | null;
    render_cloud_version: number | null;
    last_accessed_at: string;
    updated_at: string;
    created_at: string;
    owner_name: string | null;
    owner_email: string;
}

// ── POST /screenshot-list ────────────────────────────────────────

export const ScreenshotListRequestSchema = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
});
export type ScreenshotListRequest = Static<typeof ScreenshotListRequestSchema>;

/** Summary row as screenshot-list sends it — no screenshot_data. */
export interface CloudScreenshotSummary {
    id: string;
    name: string;
    created_by: string;
    owner_id: string;
    workspace_id: string;
    thumbnail_storage_path: string | null;
    width_px: number;
    height_px: number;
    capture_mode: 'visible' | 'fullPage' | 'region';
    page_url: string | null;
    last_accessed_at: string;
    updated_at: string;
    created_at: string;
    deleted_at: string | null;
    cloud_version: number;
    slug: string;
    share_policy: SharePolicy;
    workspace_access: AccessRole;
    is_shared: boolean;
}

export interface ScreenshotListResponse {
    screenshots: CloudScreenshotSummary[];
}

// ── POST /screenshot-update ──────────────────────────────────────

// Omittable ints are Optional, NEVER Union([Integer, Null]) — see the
// note in ./projects (Ajv coerces null → 0 on the integer branch).
export const ScreenshotUpdateRequestSchema = Type.Object({
    screenshotId: Type.String({ minLength: 1 }),
    screenshotData: Type.Unknown(),
    expectedVersion: Type.Optional(Type.Integer()),
});
export type ScreenshotUpdateRequest = Static<typeof ScreenshotUpdateRequestSchema>;

/** cloudVersion null = version conflict (client maps it to CloudVersionConflictError). */
export const ScreenshotUpdateResponseSchema = Type.Object({
    cloudVersion: Type.Union([Type.Integer(), Type.Null()]),
});
export type ScreenshotUpdateResponse = Static<typeof ScreenshotUpdateResponseSchema>;

// ── POST /screenshot-rename ──────────────────────────────────────

export const ScreenshotRenameRequestSchema = Type.Object({
    screenshotId: Type.String({ minLength: 1 }),
    name: Type.String(),
});
export type ScreenshotRenameRequest = Static<typeof ScreenshotRenameRequestSchema>;

export const ScreenshotRenameResponseSchema = Type.Object({
    ok: Type.Literal(true),
});
export type ScreenshotRenameResponse = Static<typeof ScreenshotRenameResponseSchema>;

// ── POST /screenshot-share ───────────────────────────────────────

export const ScreenshotShareRequestSchema = Type.Object({
    screenshotId: Type.String({ minLength: 1 }),
    sharePolicy: SharePolicySchema,
    /** Omitted keeps the current level */
    workspaceAccess: Type.Optional(AccessRoleSchema),
});
export type ScreenshotShareRequest = Static<typeof ScreenshotShareRequestSchema>;

export const ScreenshotShareResponseSchema = Type.Object({
    slug: Type.String(),
});
export type ScreenshotShareResponse = Static<typeof ScreenshotShareResponseSchema>;

// ── POST /screenshot-delete / -restore / -confirm-upload ─────────

export const ScreenshotDeleteResponseSchema = Type.Object({
    deleted: Type.Boolean(),
});
export type ScreenshotDeleteResponse = Static<typeof ScreenshotDeleteResponseSchema>;

export const ScreenshotRestoreResponseSchema = Type.Object({
    restored: Type.Boolean(),
});
export type ScreenshotRestoreResponse = Static<typeof ScreenshotRestoreResponseSchema>;

export const ScreenshotConfirmUploadResponseSchema = Type.Object({
    confirmed: Type.Boolean(),
});
export type ScreenshotConfirmUploadResponse = Static<typeof ScreenshotConfirmUploadResponseSchema>;

// ── POST /screenshot-update-thumbnail (multipart) ────────────────

export const ScreenshotThumbnailResponseSchema = Type.Object({
    storagePath: Type.String(),
});
export type ScreenshotThumbnailResponse = Static<typeof ScreenshotThumbnailResponseSchema>;

// ── POST /screenshot-render-upload (multipart) ───────────────────

/** The flattened PNG the public page serves; keyed by the cloud_version it was rendered from. */
export const ScreenshotRenderUploadResponseSchema = Type.Object({
    storagePath: Type.String(),
    renderCloudVersion: Type.Integer(),
});
export type ScreenshotRenderUploadResponse = Static<typeof ScreenshotRenderUploadResponseSchema>;

// ── POST /shared-screenshot-get (public view page) ───────────────

export const SharedScreenshotGetRequestSchema = Type.Object({
    slug: Type.String({ minLength: 1 }),
});
export type SharedScreenshotGetRequest = Static<typeof SharedScreenshotGetRequestSchema>;

export const SharedScreenshotGetResponseSchema = Type.Object({
    name: Type.String(),
    userName: Type.String(),
    widthPx: Type.Integer(),
    heightPx: Type.Integer(),
    /** Presigned URL of the flattened render; null when never published */
    imageUrl: Type.Union([Type.String(), Type.Null()]),
    /** The render predates the latest edit (a re-publish is pending) */
    stale: Type.Boolean(),
});
export type SharedScreenshotGetResponse = Static<typeof SharedScreenshotGetResponseSchema>;
