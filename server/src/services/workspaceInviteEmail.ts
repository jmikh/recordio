/**
 * Workspace-invite email send — extracted from the
 * /send-workspace-invite-email route (Part 2 Batch 3) so the
 * /workspace-invite route can send in-process instead of the SQL fn's
 * pg_net hop. Both callers share this; the route keeps its
 * service-bearer surface for the FROZEN workspace_invite() SQL fn
 * until the Part 2 sweep.
 *
 * Inviter name: real user_profiles.name → auth admin email → 'Someone'
 * (the Wave E fix). THROWS on a failed Resend send — the HTTP route
 * surfaces it as a 500; /workspace-invite catches and logs (invite
 * creation must succeed even if the email fails, pg_net parity).
 */
import type { Deps } from '../deps.js';
import type { RequestLogContext } from '../logging.js';
import {
    APP_URL,
    buildInviteEmailHtml,
    workspaceInviteSubject,
} from '../emails/workspaceInviteEmail.js';

export interface WorkspaceInviteEmailParams {
    workspaceId: string;
    /** Already lowercased by the caller */
    email: string;
    role: string;
    token: string;
    invitedBy: string;
}

export async function sendWorkspaceInviteEmail(
    deps: Pick<Deps, 'db' | 'email' | 'supabaseApi'>,
    params: WorkspaceInviteEmailParams,
    logCtx?: RequestLogContext,
): Promise<void> {
    const { workspaceId, email, role, token, invitedBy } = params;

    const [workspaceRows, profileRows] = await Promise.all([
        deps.db.query('SELECT name FROM workspaces WHERE id = $1 LIMIT 1', [workspaceId]),
        deps.db.query('SELECT name FROM user_profiles WHERE user_id = $1 LIMIT 1', [invitedBy]),
    ]);
    const workspaceName =
        (workspaceRows.rows[0] as { name: string | null } | undefined)?.name ?? 'a workspace';

    let inviterName = (profileRows.rows[0] as { name: string | null } | undefined)?.name;
    if (!inviterName) {
        const authUser = await deps.supabaseApi.getUserById(invitedBy).catch(() => {
            logCtx?.set({ error_type: 'SupabaseApiUnavailable' });
            return null;
        });
        inviterName = authUser?.email ?? 'Someone';
    }

    const acceptUrl = `${APP_URL}/accept-invite?token=${token}`;
    const result = await deps.email.send({
        to: email,
        subject: workspaceInviteSubject(inviterName, workspaceName),
        html: buildInviteEmailHtml({ workspaceName, inviterName, role, acceptUrl }),
    });
    if (!result.success) {
        throw new Error(`Resend send failed: ${result.error}`);
    }
}
