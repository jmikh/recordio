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
    ProjectEditorRemoveRequest,
    ProjectEditorSetRequest,
    ProjectEditorsResponse,
    ProjectGetRequest,
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
import type {
    WorkspaceDetails,
    WorkspaceIdRequest,
    WorkspaceInviteAcceptRequest,
    WorkspaceInviteAcceptResponse,
    WorkspaceInviteRequest,
    WorkspaceInviteRescindRequest,
    WorkspaceInviteRescindResponse,
    WorkspaceInviteResponse,
    WorkspaceListResponse,
    WorkspaceMemberRemoveRequest,
    WorkspaceMemberRemoveResponse,
    WorkspaceMemberUpdateRoleRequest,
    WorkspaceMemberUpdateRoleResponse,
    WorkspaceRenamed,
    WorkspaceRenameRequest,
    WorkspaceSetDefaultResponse,
} from './workspaces';
import type {
    DefaultWorkspace,
    EmptyRequest,
    SubscriptionGetRequest,
    SubscriptionGetResponse,
    TrialExtendRequest,
    TrialExtendResponse,
    UserProfile,
    UserReviewSetResponse,
} from './session';

export * from './assets';
export * from './entitlements';
export * from './projects';
export * from './renderJobs';
export * from './workspaces';
export * from './session';

export interface ApiRoutes {
    'asset-list': { request: AssetListRequest; response: AssetListResponse };
    'asset-delete': { request: AssetDeleteRequest; response: AssetDeleteResponse };
    'project-get': { request: ProjectGetRequest; response: CloudProject | null };
    'project-list': { request: ProjectListRequest; response: ProjectListResponse };
    'project-update': { request: ProjectUpdateRequest; response: ProjectUpdateResponse };
    'project-update-name': { request: ProjectNameUpdateRequest; response: ProjectNameUpdateResponse };
    'project-rename': { request: ProjectNameUpdateRequest; response: ProjectNameUpdateResponse };
    'project-share': { request: ProjectShareRequest; response: ProjectShareResponse };
    'project-editor-set': { request: ProjectEditorSetRequest; response: ProjectEditorsResponse };
    'project-editor-remove': { request: ProjectEditorRemoveRequest; response: ProjectEditorsResponse };
    'project-delete': { request: ProjectIdRequest; response: ProjectDeleteResponse };
    'project-restore': { request: ProjectIdRequest; response: ProjectRestoreResponse };
    'project-confirm-upload': { request: ProjectIdRequest; response: ProjectConfirmUploadResponse };
    'render-job-get-status': { request: RenderJobGetStatusRequest; response: RenderJobGetStatusResponse };
    'workspace-get': { request: WorkspaceIdRequest; response: WorkspaceDetails | null };
    'workspace-list': { request: EmptyRequest; response: WorkspaceListResponse };
    'workspace-rename': { request: WorkspaceRenameRequest; response: WorkspaceRenamed };
    'workspace-set-default': { request: WorkspaceIdRequest; response: WorkspaceSetDefaultResponse };
    'workspace-invite': { request: WorkspaceInviteRequest; response: WorkspaceInviteResponse };
    'workspace-invite-accept': { request: WorkspaceInviteAcceptRequest; response: WorkspaceInviteAcceptResponse };
    'workspace-invite-rescind': { request: WorkspaceInviteRescindRequest; response: WorkspaceInviteRescindResponse };
    'workspace-member-remove': { request: WorkspaceMemberRemoveRequest; response: WorkspaceMemberRemoveResponse };
    'workspace-member-update-role': { request: WorkspaceMemberUpdateRoleRequest; response: WorkspaceMemberUpdateRoleResponse };
    'user-profile-get': { request: EmptyRequest; response: UserProfile | null };
    'user-review-set': { request: EmptyRequest; response: UserReviewSetResponse };
    'workspace-get-default': { request: EmptyRequest; response: DefaultWorkspace };
    'subscription-get': { request: SubscriptionGetRequest; response: SubscriptionGetResponse };
    'trial-extend': { request: TrialExtendRequest; response: TrialExtendResponse };
}
