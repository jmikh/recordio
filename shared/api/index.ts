/**
 * The client↔server API contract (plans/shared-api-contract.md).
 *
 * ApiRoutes maps route name → request/response types for every route
 * both sides share. `invokeFunction` (webapp/src/api/client.ts) is
 * typed against it: a mapped name gets a checked body and a typed
 * response with no per-call-site generic. Routes not yet mapped fall
 * back to the untyped overload (Step 2 backfills Part 1 routes; Step 3
 * removes the fallback so this map becomes exhaustive).
 *
 * Compile-time only — nothing here executes on either side.
 */
import type {
    AssetDeleteRequest,
    AssetDeleteResponse,
    AssetListRequest,
    AssetListResponse,
} from './assets';
import type {
    CloudProject,
    ProjectConfirmUploadResponse,
    ProjectDeleteResponse,
    ProjectIdRequest,
    ProjectListRequest,
    ProjectListResponse,
    ProjectNameUpdateRequest,
    ProjectNameUpdateResponse,
    ProjectRestoreResponse,
    ProjectShareRequest,
    ProjectShareResponse,
    ProjectUpdateRequest,
    ProjectUpdateResponse,
} from './projects';
import type {
    RenderJobGetStatusRequest,
    RenderJobGetStatusResponse,
} from './renderJobs';

export * from './assets';
export * from './projects';
export * from './renderJobs';

export interface ApiRoutes {
    'asset-list': { request: AssetListRequest; response: AssetListResponse };
    'asset-delete': { request: AssetDeleteRequest; response: AssetDeleteResponse };
    'project-get': { request: ProjectIdRequest; response: CloudProject | null };
    'project-list': { request: ProjectListRequest; response: ProjectListResponse };
    'project-update': { request: ProjectUpdateRequest; response: ProjectUpdateResponse };
    'project-update-name': { request: ProjectNameUpdateRequest; response: ProjectNameUpdateResponse };
    'project-rename': { request: ProjectNameUpdateRequest; response: ProjectNameUpdateResponse };
    'project-share': { request: ProjectShareRequest; response: ProjectShareResponse };
    'project-delete': { request: ProjectIdRequest; response: ProjectDeleteResponse };
    'project-restore': { request: ProjectIdRequest; response: ProjectRestoreResponse };
    'project-confirm-upload': { request: ProjectIdRequest; response: ProjectConfirmUploadResponse };
    'render-job-get-status': { request: RenderJobGetStatusRequest; response: RenderJobGetStatusResponse };
}
