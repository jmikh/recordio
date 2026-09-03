/**
 * Renders every email template with sample data into .email-preview/ so
 * they can be inspected in a browser without sending anything.
 *
 * Usage: npm run email:preview   (from server/)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildSeatChangeEmailHtml,
    seatChangeSubject,
    type SeatChangeEmailOpts,
} from '../src/emails/seatChangeEmail.js';
import { buildWelcomeEmailHtml, WELCOME_EMAIL_SUBJECT } from '../src/emails/welcomeEmail.js';
import {
    APP_URL,
    buildInviteEmailHtml,
    workspaceInviteSubject,
} from '../src/emails/workspaceInviteEmail.js';

const seatChangeBase: Omit<SeatChangeEmailOpts, 'kind' | 'increased'> = {
    workspaceName: "John's Workspace",
    memberLabel: 'John Mikhail',
    role: 'creator',
    seats: 2,
    recurringTotal: '$30/month',
};

const seatVariant = (name: string, opts: SeatChangeEmailOpts) => ({
    name,
    subject: seatChangeSubject(opts),
    html: buildSeatChangeEmailHtml(opts),
});

const previews = [
    seatVariant('seat-change-joined', { ...seatChangeBase, kind: 'joined', increased: true }),
    seatVariant('seat-change-removed', {
        ...seatChangeBase,
        kind: 'removed',
        increased: false,
        seats: 1,
        recurringTotal: '$15/month',
    }),
    seatVariant('seat-change-role', { ...seatChangeBase, kind: 'role_changed', increased: true }),
    seatVariant('seat-change-no-price', {
        ...seatChangeBase,
        kind: 'joined',
        increased: true,
        recurringTotal: null,
    }),
    {
        name: 'workspace-invite',
        subject: workspaceInviteSubject('John Mikhail', "John's Workspace"),
        html: buildInviteEmailHtml({
            workspaceName: "John's Workspace",
            inviterName: 'John Mikhail',
            role: 'creator',
            acceptUrl: `${APP_URL}/accept-invite?token=preview`,
        }),
    },
    { name: 'welcome', subject: WELCOME_EMAIL_SUBJECT, html: buildWelcomeEmailHtml() },
];

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.email-preview');
mkdirSync(outDir, { recursive: true });

for (const { name, html } of previews) {
    writeFileSync(path.join(outDir, `${name}.html`), html);
}

const index = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Recordio email previews</title>
    <style>
        body { margin: 0; padding: 24px; background: #e8e8ec; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        h1 { font-size: 18px; margin: 0 0 20px 4px; }
        .grid { display: flex; flex-wrap: wrap; gap: 24px; }
        .card { width: 620px; }
        .meta { margin: 0 0 8px 4px; }
        .meta a { font-size: 14px; font-weight: 600; color: #111; text-decoration: none; }
        .meta p { margin: 2px 0 0 0; font-size: 12px; color: #666; }
        iframe { width: 100%; height: 720px; border: 1px solid #ccc; border-radius: 8px; background: #fff; }
    </style>
</head>
<body>
    <h1>Recordio email previews</h1>
    <div class="grid">
        ${previews
            .map(
                ({ name, subject }) => `
        <div class="card">
            <div class="meta">
                <a href="${name}.html" target="_blank">${name}</a>
                <p>Subject: ${subject}</p>
            </div>
            <iframe src="${name}.html" title="${name}"></iframe>
        </div>`,
            )
            .join('')}
    </div>
</body>
</html>`;

const indexPath = path.join(outDir, 'index.html');
writeFileSync(indexPath, index);

console.log(`Rendered ${previews.length} emails to ${outDir}`);
if (process.platform === 'darwin' && !process.env.CI) {
    execFileSync('open', [indexPath]);
}
