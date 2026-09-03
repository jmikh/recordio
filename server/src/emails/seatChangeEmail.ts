/**
 * Seat-change email — sent to the plan owner on every billed-quantity
 * change (billing revamp Step 6, decided 2026-09-03: email only, no
 * in-app notification). The proration line matches the Stripe behavior:
 * adds invoice immediately, removals credit the account balance.
 */
import { emailLayout } from './layout.js';
import { APP_URL } from './workspaceInviteEmail.js';

export type SeatChangeKind = 'joined' | 'removed' | 'role_changed';

export interface SeatChangeEmailOpts {
    workspaceName: string;
    /** Display name or email of the member whose change moved the count */
    memberLabel: string;
    role: string;
    kind: SeatChangeKind;
    seats: number;
    /** e.g. "$45/month" — omitted when the price couldn't be resolved */
    recurringTotal: string | null;
    increased: boolean;
}

export function seatChangeSubject(opts: SeatChangeEmailOpts): string {
    const seatsPhrase = `your plan is now ${opts.seats} ${opts.seats === 1 ? 'seat' : 'seats'}`;
    switch (opts.kind) {
        case 'joined':
            return `${opts.memberLabel} joined ${opts.workspaceName} — ${seatsPhrase}`;
        case 'removed':
            return `${opts.memberLabel} was removed from ${opts.workspaceName} — ${seatsPhrase}`;
        case 'role_changed':
            return `${opts.memberLabel}'s role changed — ${seatsPhrase}`;
    }
}

export function buildSeatChangeEmailHtml(opts: SeatChangeEmailOpts): string {
    const { workspaceName, memberLabel, role, kind, seats, recurringTotal, increased } = opts;
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

    const change =
        kind === 'joined'
            ? `<strong>${memberLabel}</strong> accepted their invitation to <strong>${workspaceName}</strong> as a <strong>${roleLabel}</strong>.`
            : kind === 'removed'
              ? `<strong>${memberLabel}</strong> was removed from <strong>${workspaceName}</strong>.`
              : `<strong>${memberLabel}</strong>'s role in <strong>${workspaceName}</strong> changed to <strong>${roleLabel}</strong>.`;

    const proration = increased
        ? 'A prorated charge for the remainder of the current billing period was invoiced today.'
        : 'A prorated credit for the unused time was applied to your account balance and will offset future invoices.';

    const seatsCell = `${seats} ${seats === 1 ? 'seat' : 'seats'}`;
    const summaryRows = recurringTotal
        ? `
            <tr>
                <td style="padding: 14px 22px; border-bottom: 1px solid #ebe9f2; font-size: 13px; color: #777777;">Seats</td>
                <td align="right" style="padding: 14px 22px; border-bottom: 1px solid #ebe9f2; font-size: 15px; font-weight: 700; color: #111111;">${seatsCell}</td>
            </tr>
            <tr>
                <td style="padding: 14px 22px; font-size: 13px; color: #777777;">New total</td>
                <td align="right" style="padding: 14px 22px; font-size: 15px; font-weight: 700; color: #111111;">${recurringTotal}</td>
            </tr>`
        : `
            <tr>
                <td style="padding: 14px 22px; font-size: 13px; color: #777777;">Seats</td>
                <td align="right" style="padding: 14px 22px; font-size: 15px; font-weight: 700; color: #111111;">${seatsCell}</td>
            </tr>`;

    const body = `
        <h1 style="margin: 0 0 20px 0; font-size: 22px; font-weight: 700; color: #111111;">
            Your seat count changed
        </h1>

        <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #444444;">
            ${change}
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; background-color: #f8f7fc; border-radius: 10px;">
            ${summaryRows}
        </table>

        <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #666666;">
            ${proration}
        </p>

        <div style="text-align: center; margin: 28px 0 0 0;">
            <a href="${APP_URL}/workspace/settings/billing"
               style="display: inline-block; background-color: #856FDC; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 12px 28px; border-radius: 8px;">
                Review billing
            </a>
        </div>

        <p style="margin: 16px 0 0 0; font-size: 13px; line-height: 1.6; color: #888888; text-align: center;">
            Seats adjust automatically as members join or leave.
        </p>
    `;

    return emailLayout(body);
}
