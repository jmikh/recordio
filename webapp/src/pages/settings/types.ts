// The workspace-details shapes are the shared API contract now
// (shared/api/workspaces.ts) — re-exported under the names the settings
// components were written against.
export type {
    WorkspaceMemberRow as WorkspaceMember,
    WorkspaceInvitationRow as WorkspaceInvitation,
    WorkspaceDetails,
} from '@shared/api';

export type BillingInterval = 'monthly' | 'yearly';
