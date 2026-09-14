/**
 * Seat capacity — the seat pre-purchase model
 * (plans/seat-prepurchase-oneshot.md).
 *
 * Seats are PURCHASED capacity, bought in advance: `subscriptions.seats`
 * mirrors the Stripe quantity and only changes through checkout,
 * /subscription-change and the subscription webhooks. Membership changes
 * never touch Stripe. This module answers "is there a free seat?":
 *
 *   used      = 1 (the owner, who has no workspace_members row)
 *               + creator/admin member rows (stale owner rows excluded)
 *   pending   = pending creator/admin invitations — they RESERVE a seat,
 *               so an admin can never invite more people than they bought
 *   available = purchased − used − pending
 *
 * Viewers are free; the hidden VIEWER_CEILING is an abuse backstop.
 */
import type { Db } from '../deps.js';

/**
 * Hidden viewer ceiling — never shown in product. At the ceiling the
 * admin sees "contact support"; support can raise it.
 */
export const VIEWER_CEILING = 50;

/** Invite / promote refusal when every purchased seat is used or reserved. */
export const NO_SEATS_AVAILABLE_ERROR =
    'No creator seats available — add seats on the billing page';

/** Accept-time refusal (the belt under the invite-time reservation). */
export const ACCEPT_NO_SEATS_ERROR =
    'This workspace has no available seats. Ask a workspace admin to add seats.';

export interface SeatUsage {
    /** subscriptions.seats; null when the workspace has no subscription row */
    purchased: number | null;
    /** Owner + creator/admin members */
    used: number;
    /** Pending creator/admin invitations (each reserves a seat) */
    pending: number;
}

/**
 * One query for the three numbers. `excludeInviteEmail` leaves that
 * email's own pending invitation out of `pending` — the invite route
 * deletes + reinserts the row, so a re-invite must not block on its own
 * reservation.
 */
export async function getSeatUsage(
    db: Db,
    workspaceId: string,
    opts: { excludeInviteEmail?: string } = {},
): Promise<SeatUsage> {
    const { rows } = await db.query(
        `SELECT
            (SELECT s.seats FROM subscriptions s WHERE s.workspace_id = w.id) AS purchased,
            (SELECT COUNT(*)::int FROM workspace_members wm
             WHERE wm.workspace_id = w.id
               AND wm.user_id <> w.owner_id
               AND wm.role IN ('creator', 'admin')) + 1 AS used,
            (SELECT COUNT(*)::int FROM workspace_invitations wi
             WHERE wi.workspace_id = w.id
               AND wi.status = 'pending'
               AND wi.role IN ('creator', 'admin')
               AND ($2::text IS NULL OR wi.email <> $2)) AS pending
         FROM workspaces w
         WHERE w.id = $1`,
        [workspaceId, opts.excludeInviteEmail ?? null],
    );
    const row = rows[0] as
        | { purchased: number | null; used: number; pending: number }
        | undefined;
    return {
        purchased: row?.purchased ?? null,
        used: row?.used ?? 1,
        pending: row?.pending ?? 0,
    };
}

/** Free seats, clamped at 0 (over-capacity after a seat reduction is grandfathered, not negative). */
export function seatsAvailable(usage: SeatUsage): number {
    if (usage.purchased === null) return 0;
    return Math.max(0, usage.purchased - usage.used - usage.pending);
}
