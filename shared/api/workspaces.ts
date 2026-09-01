/**
 * Client↔server contract for the workspace routes (Part 2 Batch 3+4,
 * plans/fastify-part2-3-workspaces-session-rpc-migration-prompt.md).
 * Same rules as the sibling files: TypeBox schemas ARE the server's
 * runtime validation; plain interfaces cover the jsonb-blob responses
 * the server deliberately doesn't schema-validate (snake_case — the
 * wire shape the client already consumed from the SQL RPCs).
 */
import { Type, type Static } from '@sinclair/typebox';

export const WorkspaceRoleSchema = Type.Union([
    Type.Literal('viewer'),
    Type.Literal('creator'),
    Type.Literal('admin'),
]);
export type WorkspaceRole = Static<typeof WorkspaceRoleSchema>;

/** Shared request body of workspace-get / workspace-set-default. */
export const WorkspaceIdRequestSchema = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
});
export type WorkspaceIdRequest = Static<typeof WorkspaceIdRequestSchema>;

// ── POST /workspace-list ─────────────────────────────────────────

/** Row of the workspace switcher list (workspace_list's blob). */
export interface WorkspaceSummary {
    id: string;
    name: string;
    owner_id: string;
    role: WorkspaceRole;
    seats: number | null;
    created_at: string;
    updated_at: string;
}

export interface WorkspaceListResponse {
    workspaces: WorkspaceSummary[];
}

// ── POST /workspace-get ──────────────────────────────────────────

export interface WorkspaceMemberRow {
    user_id: string;
    role: WorkspaceRole;
    email: string;
    name: string | null;
    created_at: string;
}

/**
 * No expires_at: invitations stopped expiring (migration 20260513042717)
 * and the route port drops the SQL fn's stale expires_at filter/field —
 * the fn's `expires_at > now()` over NULLs meant this list was always
 * empty (live bug fixed at the Batch 3 port; see suggested_changes).
 */
export interface WorkspaceInvitationRow {
    id: string;
    email: string;
    role: WorkspaceRole;
    invited_by: string;
    created_at: string;
}

/** workspace_get's blob: details + members + pending invitations. */
export interface WorkspaceDetails {
    id: string;
    name: string;
    owner_id: string;
    role: WorkspaceRole;
    seats: number | null;
    /** Derived server-side: seats * 10 */
    viewer_seats: number | null;
    members: WorkspaceMemberRow[];
    invitations: WorkspaceInvitationRow[];
    created_at: string;
    updated_at: string;
}

// ── POST /workspace-rename ───────────────────────────────────────

export const WorkspaceRenameRequestSchema = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
    name: Type.String(),
});
export type WorkspaceRenameRequest = Static<typeof WorkspaceRenameRequestSchema>;

/** workspace_rename's blob (client reads `name` for the toast). */
export interface WorkspaceRenamed {
    id: string;
    name: string;
    owner_id: string;
    created_at: string;
    updated_at: string;
}

// ── POST /workspace-set-default ──────────────────────────────────

export const WorkspaceSetDefaultResponseSchema = Type.Object({
    ok: Type.Literal(true),
});
export type WorkspaceSetDefaultResponse = Static<typeof WorkspaceSetDefaultResponseSchema>;

// ── POST /workspace-invite ───────────────────────────────────────

export const WorkspaceInviteRequestSchema = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
    email: Type.String({ minLength: 1 }),
    role: WorkspaceRoleSchema,
});
export type WorkspaceInviteRequest = Static<typeof WorkspaceInviteRequestSchema>;

export const WorkspaceInviteResponseSchema = Type.Object({
    invitationId: Type.String(),
    token: Type.String(),
});
export type WorkspaceInviteResponse = Static<typeof WorkspaceInviteResponseSchema>;

// ── POST /workspace-invite-accept ────────────────────────────────

export const WorkspaceInviteAcceptRequestSchema = Type.Object({
    token: Type.String({ minLength: 1 }),
});
export type WorkspaceInviteAcceptRequest = Static<typeof WorkspaceInviteAcceptRequestSchema>;

/**
 * Business failures come back as 200 + `error` (the AcceptInvitePage
 * displays the exact message — the asset-upload `library_full`
 * precedent). Success has workspaceId/role set and no error.
 */
export const WorkspaceInviteAcceptResponseSchema = Type.Object({
    workspaceId: Type.Optional(Type.String()),
    role: Type.Optional(WorkspaceRoleSchema),
    error: Type.Optional(Type.String()),
});
export type WorkspaceInviteAcceptResponse = Static<typeof WorkspaceInviteAcceptResponseSchema>;

// ── POST /workspace-invite-rescind ───────────────────────────────

export const WorkspaceInviteRescindRequestSchema = Type.Object({
    invitationId: Type.String({ minLength: 1 }),
});
export type WorkspaceInviteRescindRequest = Static<typeof WorkspaceInviteRescindRequestSchema>;

export const WorkspaceInviteRescindResponseSchema = Type.Object({
    invitationId: Type.String(),
});
export type WorkspaceInviteRescindResponse = Static<typeof WorkspaceInviteRescindResponseSchema>;

// ── POST /workspace-member-remove ────────────────────────────────

export const WorkspaceMemberRemoveRequestSchema = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
});
export type WorkspaceMemberRemoveRequest = Static<typeof WorkspaceMemberRemoveRequestSchema>;

export const WorkspaceMemberRemoveResponseSchema = Type.Object({
    transferredCount: Type.Integer(),
});
export type WorkspaceMemberRemoveResponse = Static<typeof WorkspaceMemberRemoveResponseSchema>;

// ── POST /workspace-member-update-role ───────────────────────────

export const WorkspaceMemberUpdateRoleRequestSchema = Type.Object({
    workspaceId: Type.String({ minLength: 1 }),
    userId: Type.String({ minLength: 1 }),
    role: WorkspaceRoleSchema,
});
export type WorkspaceMemberUpdateRoleRequest = Static<typeof WorkspaceMemberUpdateRoleRequestSchema>;

export const WorkspaceMemberUpdateRoleResponseSchema = Type.Object({
    ok: Type.Literal(true),
});
export type WorkspaceMemberUpdateRoleResponse = Static<typeof WorkspaceMemberUpdateRoleResponseSchema>;
