import { useState, useEffect } from 'react';
import { LuCheck, LuCreditCard, LuShieldCheck, LuExternalLink, LuMinus, LuPlus } from 'react-icons/lu';
import { MARKETING_ORIGIN } from '@shared/urls';
import { Button } from '@shared/components';
import { AuthManager } from '../../auth/AuthManager';
import { apiErrorMessage, invokeFunction } from '../../api/client';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useUserStore } from '../../auth/useUserStore';
import { useEntitlements } from '../../billing/useEntitlements';
import { TrialExtendLink } from '../../billing/TrialExtendLink';
import { useToast } from '../../components/Toast';
import { StripeService, type SubscriptionChangePreview } from '../../billing/StripeService';
import { PRICE_MONTHLY, PRICE_YEARLY } from '../../billing/prices';
import type { BillingInterval } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

// Pro-only highlights shown here; the full Free/Pro matrix lives on the marketing site
const PRO_HIGHLIGHTS = [
    'Background & 4K export',
    'Share videos by link',
    'Team workspace with roles',
    'Captions-based editing & word-by-word highlights',
    'Custom background uploads',
    'OpenAI transcription',
    'Restore deleted videos for 30 days',
];

const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

// ─── Seat stepper ─────────────────────────────────────────────────────────────

function SeatStepper({ value, min, onChange, disabled }: {
    value: number;
    min: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Seat count">
            <Button
                variant="ghost"
                icon={LuMinus}
                aria-label="Remove seat"
                onClick={() => onChange(value - 1)}
                disabled={disabled || value <= min}
            />
            <output aria-label="Seats" className="min-w-8 text-center text-sm font-bold text-text-highlighted">
                {value}
            </output>
            <Button
                variant="ghost"
                icon={LuPlus}
                aria-label="Add seat"
                onClick={() => onChange(value + 1)}
                disabled={disabled}
            />
        </div>
    );
}

// ─── Seat bar ─────────────────────────────────────────────────────────────────

/**
 * Purchased seats at a glance: solid = filled by a creator/admin, faded =
 * reserved by a pending invitation, empty = free to hand out. Small teams
 * get one pill per seat; past 20 that reads as noise, so it falls back to
 * a proportional bar.
 */
function SeatBar({ used, pending, total }: { used: number; pending: number; total: number }) {
    // Stale details can briefly report more seats in use than purchased
    const capacity = Math.max(total, used + pending, 1);
    const label =
        `${used} of ${total} ${total === 1 ? 'seat' : 'seats'} used`
        + (pending > 0 ? `, ${pending} reserved by ${pending === 1 ? 'a pending invitation' : 'pending invitations'}` : '');

    if (capacity <= 20) {
        return (
            <div className="flex gap-1 w-full" role="img" aria-label={label}>
                {Array.from({ length: capacity }, (_, i) => (
                    <span
                        key={i}
                        className={`h-2 flex-1 rounded-full ${
                            i < used ? 'bg-primary' : i < used + pending ? 'bg-primary/40' : 'bg-state-inactive'
                        }`}
                    />
                ))}
            </div>
        );
    }
    const pct = (n: number) => `${(n / capacity) * 100}%`;
    return (
        <div className="flex h-2 w-full rounded-full overflow-hidden bg-state-inactive" role="img" aria-label={label}>
            <div className="bg-primary" style={{ width: pct(used) }} />
            <div className="bg-primary/40" style={{ width: pct(pending) }} />
        </div>
    );
}

/** A legend swatch matching one band of the seat bar. */
function SeatKey({ className, children }: { className: string; children: React.ReactNode }) {
    return (
        <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${className}`} />
            {children}
        </span>
    );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Seats are purchased in advance (plans/seat-prepurchase-oneshot.md):
 * the checkout card picks how many to buy, the active-plan stepper
 * changes the count later (increase = prorated charge now, decrease =
 * unused time credited to the Stripe balance). Billing mutations
 * (checkout, seats, portal) are OWNER-only — admins manage people,
 * not the subscription.
 */
export function BillingSection({ usedSeats = 1, reservedSeats = 0, viewerCount = 0, onSeatsChanged }: {
    /** Owner + creator/admin members — seats in use, and the checkout minimum */
    usedSeats?: number;
    /** Pending creator/admin invitations — each reserves a purchased seat */
    reservedSeats?: number;
    /** Viewer members — free, reported next to the seat count */
    viewerCount?: number;
    /** The purchased count changed on the server — hosts refresh their seat displays */
    onSeatsChanged?: (seats: number) => void;
}) {
    const { hasActivePlan, subscription, workspaceId, workspaceOwnerId } = useWorkspaceStore();
    const entitlements = useEntitlements();
    const { userId, email, isAuthenticated } = useUserStore();
    const { addToast } = useToast();

    // The plan belongs to the workspace owner: buying it, changing the seat
    // count and the Stripe portal are owner-only. Admins run the member list
    // (invite / role / remove) but never the subscription.
    const isOwner = Boolean(userId && workspaceOwnerId && userId === workspaceOwnerId);

    // Seats already spoken for — the floor when reducing the purchased count
    const seatFloor = usedSeats + reservedSeats;

    // ── Checkout flow state ───────────────────────────────────────────────────
    const [billingInterval, setBillingInterval] = useState<BillingInterval>('yearly');
    const [checkoutSeats,   setCheckoutSeats]   = useState(usedSeats);
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [checkingStatus,  setCheckingStatus]  = useState(false);
    const [checkoutSuccess, setCheckoutSuccess] = useState(false);
    const [checkoutError,   setCheckoutError]   = useState<string | null>(null);

    // ── Manage portal state ───────────────────────────────────────────────────
    const [manageLoading, setManageLoading] = useState(false);

    const isTrialing = entitlements.state === 'trial';
    const isActive   = hasActivePlan && subscription?.status === 'active';

    // ── Purchased-seat stepper state (active plan) ────────────────────────────
    const currentSeats = subscription?.seats ?? 1;
    const [draftSeats, setDraftSeats]               = useState(currentSeats);
    const [seatPreview, setSeatPreview]             = useState<SubscriptionChangePreview | null>(null);
    const [seatPreviewLoading, setSeatPreviewLoading] = useState(false);
    const [seatPreviewError, setSeatPreviewError]   = useState<string | null>(null);
    const [applyingSeats, setApplyingSeats]         = useState(false);
    const seatsDirty = isActive && draftSeats !== currentSeats;

    // Follow the server's count (after apply / refresh / workspace switch)
    useEffect(() => { setDraftSeats(currentSeats); }, [currentSeats]);
    // The checkout minimum can only grow (members loaded after mount)
    useEffect(() => { setCheckoutSeats(s => Math.max(s, usedSeats)); }, [usedSeats]);

    // Debounced dry-run preview of the seat change
    useEffect(() => {
        if (!seatsDirty || !workspaceId) {
            setSeatPreview(null);
            setSeatPreviewError(null);
            setSeatPreviewLoading(false);
            return;
        }
        let cancelled = false;
        setSeatPreviewLoading(true);
        setSeatPreview(null);
        setSeatPreviewError(null);
        const timer = setTimeout(async () => {
            const { preview, error } = await StripeService.subscriptionChange({
                workspaceId, newSeats: draftSeats, dryRun: true,
            });
            if (cancelled) return;
            setSeatPreviewLoading(false);
            if (error || !preview) {
                setSeatPreviewError(await apiErrorMessage(error, 'Could not calculate the price change.'));
                return;
            }
            setSeatPreview(preview);
        }, 500);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [seatsDirty, draftSeats, workspaceId]);

    // ── Poll for checkout activation ──────────────────────────────────────────
    useEffect(() => {
        if (!checkingStatus || !userId || checkoutSuccess) return;
        const poll = setInterval(async () => {
            // Omit workspaceId (never null) for the oldest-owned fallback
            const { data, error: rpcErr } = await invokeFunction(
                'subscription-get',
                workspaceId ? { workspaceId } : {},
            );
            if (rpcErr || !data) return;
            if (data.subscription?.status === 'active') {
                setCheckoutSuccess(true);
                setCheckingStatus(false);
                await AuthManager.refreshSubscription();
                onSeatsChanged?.(data.subscription.seats);
            }
        }, 1000);
        return () => clearInterval(poll);
    }, [checkingStatus, userId, checkoutSuccess, workspaceId, onSeatsChanged]);

    // ── Handlers ──────────────────────────────────────────────────────────────
    const handleCheckout = async () => {
        if (!isAuthenticated || !userId || !email || hasActivePlan) return;
        setCheckoutLoading(true);
        setCheckoutError(null);
        const { error: err } = await StripeService.createCheckoutSession(
            userId, email, billingInterval, workspaceId, checkoutSeats,
        );
        setCheckoutLoading(false);
        if (err) {
            setCheckoutError(await apiErrorMessage(err, err.message || 'Failed to start checkout. Please try again.'));
        } else {
            setCheckingStatus(true);
        }
    };

    const handleApplySeats = async () => {
        if (!workspaceId || !seatsDirty) return;
        setApplyingSeats(true);
        const { error: err } = await StripeService.subscriptionChange({
            workspaceId, newSeats: draftSeats, dryRun: false,
        });
        setApplyingSeats(false);
        if (err) {
            addToast({ type: 'error', title: await apiErrorMessage(err, 'Failed to update seats') });
            return;
        }
        addToast({ type: 'success', title: `Seats updated to ${draftSeats}` });
        onSeatsChanged?.(draftSeats);
        await AuthManager.refreshSubscription();
    };

    const handleManage = async () => {
        setManageLoading(true);
        const { url, error: err } = await StripeService.createPortalSession();
        setManageLoading(false);
        if (err || !url) {
            addToast({ type: 'error', title: 'Failed to open billing portal' });
            return;
        }
        window.open(url, '_blank');
    };

    const seatPrice     = billingInterval === 'monthly' ? PRICE_MONTHLY : PRICE_YEARLY;
    const savings       = Math.round((1 - PRICE_YEARLY / PRICE_MONTHLY) * 100);
    const planIsYearly  = subscription?.billingInterval === 'yearly';
    const planSeatPrice = planIsYearly ? PRICE_YEARLY : PRICE_MONTHLY;
    const seatWord      = (n: number) => (n === 1 ? 'seat' : 'seats');
    // Against the DRAFT count, so stepping previews what the change leaves free
    const availableSeats = Math.max(0, draftSeats - seatFloor);

    return (
        <div className="w-full flex flex-col gap-6">
            {/* ── Current plan status ── */}
            <div className="border border-border rounded-[var(--radius-md)] p-5 flex flex-col gap-5">

                {/* Plan name + manage button */}
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <p className="text-eyebrow">Current plan</p>
                        <p className="text-sm font-bold text-text-highlighted">
                            {isTrialing ? 'Pro (Trial)' : entitlements.state === 'free' ? 'Free' : 'Pro'}
                            {hasActivePlan && subscription != null && (
                                <span className="text-text-muted ml-1.5">
                                    {' '}· {subscription.seats} {seatWord(subscription.seats)}
                                </span>
                            )}
                        </p>
                        {isTrialing && entitlements.trialEndsAt && (
                            <p className="text-xs text-text-muted">
                                Trial ends {formatDate(entitlements.trialEndsAt)}
                            </p>
                        )}
                        <TrialExtendLink className="self-start" />
                        {hasActivePlan && !isTrialing && subscription?.currentPeriodEnd && (
                            <p className="text-xs text-text-muted">
                                {subscription.cancelAt ? 'Access until' : 'Renews'}{' '}
                                {formatDate((subscription.cancelAt ?? subscription.currentPeriodEnd).toISOString())}
                                {subscription.billingInterval && (
                                    <span className="ml-1 capitalize">· {subscription.billingInterval}</span>
                                )}
                            </p>
                        )}
                    </div>
                    {hasActivePlan && subscription?.stripeCustomerId && isOwner && (
                        <Button variant="base" onClick={handleManage} disabled={manageLoading}>
                            <LuCreditCard className="icon-sm" />
                            {manageLoading ? 'Loading…' : 'Manage billing'}
                        </Button>
                    )}
                </div>

                {/* ── Purchased seats (admins change them here) ── */}
                {isActive && (
                    <div className="flex flex-col gap-3 pt-4 border-t border-border">
                        <div className="flex items-center justify-between gap-4">
                            <p className="text-sm font-bold text-text-highlighted">
                                Seats
                                {/* The stepper already reads out the count for owners */}
                                {!isOwner && <span className="text-text-muted"> {draftSeats}</span>}
                            </p>
                            {isOwner && (
                                <SeatStepper
                                    value={draftSeats}
                                    min={seatFloor}
                                    onChange={setDraftSeats}
                                    disabled={applyingSeats}
                                />
                            )}
                        </div>

                        <SeatBar used={usedSeats} pending={reservedSeats} total={draftSeats} />

                        <div className="flex items-center gap-3 flex-wrap text-xs text-text-muted">
                            <SeatKey className="bg-primary">{usedSeats} used</SeatKey>
                            {reservedSeats > 0 && <SeatKey className="bg-primary/40">{reservedSeats} pending</SeatKey>}
                            <SeatKey className="bg-state-inactive">{availableSeats} free</SeatKey>
                            {viewerCount > 0 && <span>· {viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'} (free)</span>}
                            <span className="ml-auto">
                                ${draftSeats * planSeatPrice}/mo{planIsYearly ? ' · billed yearly' : ''}
                            </span>
                        </div>
                        {seatsDirty && (
                            <div
                                role="status"
                                className="bg-primary/10 border border-primary/30 rounded-md px-3 py-2 text-xs text-text-highlighted flex flex-col gap-1"
                            >
                                {seatPreviewLoading && <span>Calculating the price change…</span>}
                                {seatPreviewError && <span className="text-destructive">{seatPreviewError}</span>}
                                {seatPreview && (
                                    <>
                                        <span>
                                            {seatPreview.immediateCharge >= 0
                                                ? `Charged today: $${seatPreview.immediateCharge.toFixed(2)}`
                                                : `Credited to your balance: $${Math.abs(seatPreview.immediateCharge).toFixed(2)}`}
                                        </span>
                                        <span>
                                            Next renewal: ${seatPreview.nextRenewalAmount.toFixed(2)} on {formatDate(seatPreview.nextRenewalDate)}
                                        </span>
                                        {draftSeats < currentSeats && (
                                            <span className="text-text-muted">
                                                Unused time for removed seats is credited to your next invoice.
                                            </span>
                                        )}
                                    </>
                                )}
                                <div className="flex items-center gap-2 pt-1">
                                    <Button
                                        variant="primary"
                                        onClick={handleApplySeats}
                                        disabled={applyingSeats || seatPreviewLoading}
                                    >
                                        {applyingSeats ? 'Updating…' : 'Update seats'}
                                    </Button>
                                    <Button
                                        variant="base"
                                        onClick={() => setDraftSeats(currentSeats)}
                                        disabled={applyingSeats}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Everyone but the owner can see the plan, not manage it */}
                {hasActivePlan && !isOwner && (
                    <p className="text-xs text-text-muted">
                        Only the workspace owner can change the plan or the number of seats.
                    </p>
                )}

                {/* ── Checkout polling / success ── */}
                {checkingStatus && !checkoutSuccess && (
                    <div className="bg-primary/10 border border-primary/30 rounded-md px-3 py-2 text-xs text-text-highlighted">
                        Waiting for payment… complete checkout in the other tab, then return here.
                    </div>
                )}
                {checkoutSuccess && (
                    <div className="bg-success/10 border border-success/30 rounded-md px-3 py-2 text-xs text-success flex items-center gap-2">
                        <LuCheck className="icon-sm shrink-0" />
                        Subscription activated — welcome!
                    </div>
                )}
                {checkoutError && (
                    <div className="bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 text-xs text-destructive">
                        {checkoutError}
                    </div>
                )}
            </div>

            {/* ── Upgrade — compact; the full comparison lives on the marketing site.
                 Owner-only: buying the plan is the owner's call ── */}
            {!hasActivePlan && !isOwner && (
                <p className="text-sm text-text-muted">
                    Only the workspace owner can buy a plan or seats for this workspace.
                </p>
            )}
            {!hasActivePlan && isOwner && (
                <div className="border border-border rounded-[var(--radius-md)] p-5 flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-sm font-bold text-text-highlighted">Upgrade to Pro</h3>
                            <p className="text-xs text-text-muted mt-0.5">
                                ${seatPrice} / seat / month · {billingInterval === 'yearly' ? 'billed annually' : 'billed monthly'}
                            </p>
                        </div>
                        <div className="flex items-center gap-1 bg-state-inactive rounded-full p-1 shrink-0">
                            {(['monthly', 'yearly'] as BillingInterval[]).map(iv => (
                                <button
                                    key={iv}
                                    type="button"
                                    onClick={() => setBillingInterval(iv)}
                                    className={`py-1 px-3 text-xs rounded-full transition-all flex items-center gap-1.5 cursor-pointer ${
                                        billingInterval === iv
                                            ? 'bg-primary text-text-on-primary shadow-sm'
                                            : 'text-text-muted hover:text-text-main'
                                    }`}
                                >
                                    {iv === 'monthly' ? 'Monthly' : 'Annual'}
                                    {iv === 'yearly' && (
                                        <span className={`text-badge px-1.5 py-0.5 rounded-full ${
                                            billingInterval === 'yearly'
                                                ? 'bg-text-on-primary/20 text-text-on-primary'
                                                : 'bg-primary/15 text-primary'
                                        }`}>
                                            -{savings}%
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Seats to buy — creator/admin seats are purchased up front */}
                    <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                        <div>
                            <p className="text-sm font-bold text-text-highlighted">Seats</p>
                            <p className="text-xs text-text-muted">
                                {checkoutSeats} × ${seatPrice} = ${checkoutSeats * seatPrice}/mo · viewers are free
                            </p>
                        </div>
                        <SeatStepper
                            value={checkoutSeats}
                            min={usedSeats}
                            onChange={setCheckoutSeats}
                            disabled={checkoutLoading || checkingStatus}
                        />
                    </div>

                    {/* Pro-only highlights */}
                    <ul className="flex flex-col gap-1.5">
                        {PRO_HIGHLIGHTS.map(feature => (
                            <li key={feature} className="flex items-center gap-2 text-sm text-text-main">
                                <LuCheck className="icon-sm text-success shrink-0" />
                                {feature}
                            </li>
                        ))}
                    </ul>

                    <Button
                        variant="primary"
                        fullWidth
                        onClick={handleCheckout}
                        disabled={checkoutLoading || checkingStatus}
                    >
                        {checkoutLoading ? 'Loading…' : checkingStatus ? 'Waiting…' : 'Upgrade to Pro'}
                    </Button>

                    <div className="flex items-center justify-between gap-4 text-xs text-text-muted">
                        <span className="flex items-center gap-1">
                            <LuShieldCheck className="icon-sm" /> Secure with Stripe · Cancel anytime
                        </span>
                        <a
                            href={`${MARKETING_ORIGIN}/pricing`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline shrink-0"
                        >
                            Compare all plans <LuExternalLink className="icon-sm" />
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
}
