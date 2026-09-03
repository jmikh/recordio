/**
 * Seat auto-scaling (billing revamp Step 6,
 * plans/workspace-billing-revamp/workspace-billing-revamp-step-6.md).
 *
 * The billed quantity is DERIVED STATE, never arithmetic: it is always
 * recomputed as `1 (owner) + creator/admin member rows` and SET on the
 * Stripe subscription — no +1/−1 deltas to drift. Every seat-affecting
 * event (invite acceptance, member removal, role change across the
 * viewer↔creator/admin boundary) calls syncSeatQuantity after its DB
 * write commits; a failed Stripe sync never blocks or reverts the
 * membership change and self-heals on the next seat event.
 */
import type { Db, Deps } from '../deps.js';
import type { StripePrice } from '../ports/stripe.js';
import {
    buildSeatChangeEmailHtml,
    seatChangeSubject,
    type SeatChangeKind,
} from '../emails/seatChangeEmail.js';

/**
 * Hidden viewer ceiling — an abuse backstop, never shown in product
 * (decided 2026-09-03, Step 6 planning). At the ceiling the admin sees
 * "contact support"; support can raise it.
 */
export const VIEWER_CEILING = 50;

/** Statuses whose Stripe subscription we keep in sync (matches PRO_STATUSES). */
const SYNCABLE_STATUSES = new Set(['active', 'past_due', 'trialing']);

/** Structural logger — matches both pino and Fastify's req.log. */
export interface SeatSyncLog {
    info(obj: object, msg?: string): void;
    warn(obj: object, msg?: string): void;
    error(obj: object, msg?: string): void;
}

export interface SeatChangeContext {
    kind: SeatChangeKind;
    /** Email of the member whose change moved the count */
    memberEmail: string;
    /** Display name when known — email is the fallback label */
    memberName?: string | null;
    role: string;
}

/**
 * Billed seats = 1 (the owner, who has no workspace_members row) +
 * creator/admin member rows. Viewers are free; stale pre-Step-2 owner
 * rows are excluded so they can never double-count the owner.
 */
export async function computeBilledSeats(db: Db, workspaceId: string): Promise<number> {
    const { rows } = await db.query(
        `SELECT COUNT(*)::int + 1 AS count
         FROM workspace_members wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.workspace_id = $1
           AND wm.user_id <> w.owner_id
           AND wm.role IN ('creator', 'admin')`,
        [workspaceId],
    );
    return (rows[0] as { count: number } | undefined)?.count ?? 1;
}

/**
 * Recompute-and-set. No-op unless the workspace has a Stripe-linked
 * subscription in a syncable status and the live quantity differs from
 * the computed count. On change: Stripe update (always_invoice — adds
 * charge now, removals credit the balance) → direct DB seats write (the
 * webhook stays authoritative on re-sync) → seat-change email to the
 * plan owner (fire-and-forget).
 *
 * NEVER throws — membership changes must not fail on billing.
 */
export async function syncSeatQuantity(
    deps: Pick<Deps, 'db' | 'stripe' | 'email'>,
    workspaceId: string,
    change: SeatChangeContext,
    log: SeatSyncLog,
): Promise<void> {
    try {
        const { rows } = await deps.db.query(
            `SELECT s.status, s.billing_interval, s.stripe_subscription_id,
                    w.name AS workspace_name,
                    (SELECT u.email FROM auth.users u WHERE u.id = w.owner_id) AS owner_email
             FROM workspaces w
             LEFT JOIN subscriptions s ON s.workspace_id = w.id
             WHERE w.id = $1 AND w.deleted_at IS NULL`,
            [workspaceId],
        );
        const sub = rows[0] as
            | {
                  status: string | null;
                  billing_interval: string | null;
                  stripe_subscription_id: string | null;
                  workspace_name: string;
                  owner_email: string | null;
              }
            | undefined;
        if (
            !sub ||
            sub.status === null ||
            !SYNCABLE_STATUSES.has(sub.status) ||
            !sub.stripe_subscription_id
        ) {
            return;
        }

        const computed = await computeBilledSeats(deps.db, workspaceId);
        const stripeSub = await deps.stripe.getSubscription(sub.stripe_subscription_id, {
            expandItemPrices: true,
        });
        const item = stripeSub.items?.data[0];
        if (!item) {
            log.warn(
                { 'workspace.id': workspaceId },
                'seat sync: Stripe subscription has no item',
            );
            return;
        }
        if (item.quantity === computed) return;
        const increased = computed > (item.quantity ?? 0);

        await deps.stripe.updateSubscription(sub.stripe_subscription_id, {
            items: [{ id: item.id, quantity: computed }],
            proration_behavior: 'always_invoice',
        });

        // Immediate DB sync so the client sees the change right away;
        // the Stripe webhook remains authoritative and re-syncs later
        await deps.db.query(
            `UPDATE subscriptions
             SET seats = $2, updated_at = now()
             WHERE workspace_id = $1`,
            [workspaceId, computed],
        );
        log.info(
            { 'workspace.id': workspaceId, seats: computed, kind: change.kind },
            'seat quantity auto-scaled',
        );

        if (!sub.owner_email) return;
        const unitAmount =
            typeof item.price === 'object' && item.price
                ? ((item.price as StripePrice).unit_amount ?? null)
                : null;
        const interval = sub.billing_interval === 'yearly' ? 'year' : 'month';
        const recurringTotal =
            unitAmount !== null ? `$${((unitAmount * computed) / 100).toFixed(0)}/${interval}` : null;
        const emailOpts = {
            workspaceName: sub.workspace_name,
            memberLabel: change.memberName || change.memberEmail,
            role: change.role,
            kind: change.kind,
            seats: computed,
            recurringTotal,
            increased,
        };
        const result = await deps.email.send({
            to: sub.owner_email,
            subject: seatChangeSubject(emailOpts),
            html: buildSeatChangeEmailHtml(emailOpts),
        });
        if (!result.success) {
            log.warn(
                { 'workspace.id': workspaceId, 'email.template': 'seat-change', err: result.error },
                'seat-change email failed',
            );
        }
    } catch (err) {
        log.error({ err, 'workspace.id': workspaceId }, 'seat quantity sync failed');
    }
}
