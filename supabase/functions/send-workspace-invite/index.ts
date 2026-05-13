import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendEmail } from '../_shared/emails/resend.ts';
import { emailLayout } from '../_shared/emails/layout.ts';
import { corsHeaders } from '../_shared/auth.ts';
import { captureException } from '../_shared/sentry.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const APP_URL = 'https://app.recordio.io';

function buildInviteEmailHtml(opts: {
    workspaceName: string;
    inviterName: string;
    role: string;
    acceptUrl: string;
}): string {
    const { workspaceName, inviterName, role, acceptUrl } = opts;
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

    const body = `
        <h1 style="margin: 0 0 20px 0; font-size: 22px; font-weight: 700; color: #111111;">
            You've been invited to join a workspace
        </h1>

        <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #444444;">
            <strong>${inviterName}</strong> has invited you to join <strong>${workspaceName}</strong> on Recordio as a <strong>${roleLabel}</strong>.
        </p>

        <div style="text-align: center; margin: 32px 0;">
            <a href="${acceptUrl}"
               style="display: inline-block; background-color: #856FDC; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 12px 28px; border-radius: 8px;">
                Accept Invitation
            </a>
        </div>

        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #888888; text-align: center;">
            If you weren't expecting this invitation, you can safely ignore this email.
        </p>
    `;

    return emailLayout({ body });
}

// ============================================================================
// Handler — called by workspace_invite DB function via net.http_post
// ============================================================================

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { workspace_id, email, role, token, invited_by } = await req.json();

        if (!workspace_id || !email || !role || !token || !invited_by) {
            console.error('[WorkspaceInvite] Missing required fields');
            return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
        }

        // Fetch workspace name
        const { data: workspace } = await supabase
            .from('workspaces')
            .select('name')
            .eq('id', workspace_id)
            .maybeSingle();

        const workspaceName = workspace?.name ?? 'a workspace';

        // Fetch inviter display name
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('display_name')
            .eq('user_id', invited_by)
            .maybeSingle();

        // Fall back to email if no display name
        let inviterName = profile?.display_name as string | null;
        if (!inviterName) {
            const { data: authUser } = await supabase.auth.admin.getUserById(invited_by);
            inviterName = authUser?.user?.email ?? 'Someone';
        }

        const acceptUrl = `${APP_URL}/accept-invite?token=${token}`;

        const html = buildInviteEmailHtml({ workspaceName, inviterName, role, acceptUrl });

        const result = await sendEmail({
            to: email,
            subject: `${inviterName} invited you to join ${workspaceName} on Recordio`,
            html,
        });

        if (!result.success) {
            console.error('[WorkspaceInvite] Failed to send:', result.error);
            return new Response(JSON.stringify({ error: result.error }), { status: 500 });
        }

        console.log('[WorkspaceInvite] Sent invite to:', email);
        return new Response(JSON.stringify({ sent: true }), { status: 200 });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[WorkspaceInvite] Error:', message);
        await captureException(err, { function: 'send-workspace-invite' });
        return new Response(JSON.stringify({ error: message }), { status: 500 });
    }
});
