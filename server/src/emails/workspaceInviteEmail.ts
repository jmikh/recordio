/**
 * Workspace-invite email — ports the template from the
 * `send-workspace-invite` edge fn verbatim. APP_URL stays hardcoded as
 * in the edge fn (flagged in the plan analysis).
 */
import { emailLayout } from './layout.js';

export const APP_URL = 'https://app.recordio.io';

export function workspaceInviteSubject(inviterName: string, workspaceName: string): string {
    return `${inviterName} invited you to join ${workspaceName} on Recordio`;
}

export function buildInviteEmailHtml(opts: {
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

    return emailLayout(body);
}
