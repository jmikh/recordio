import { useState, useEffect } from 'react';
import { LuCheck, LuCreditCard, LuShieldCheck, LuExternalLink } from 'react-icons/lu';
import { MARKETING_ORIGIN } from '@shared/urls';
import { Button } from '@shared/components';
import { AuthManager } from '../../auth/AuthManager';
import { invokeFunction } from '../../api/client';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useUserStore } from '../../auth/useUserStore';
import { useEntitlements } from '../../billing/useEntitlements';
import { TrialExtendLink } from '../../billing/TrialExtendLink';
import { useToast } from '../../components/Toast';
import { StripeService } from '../../billing/StripeService';
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

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * No seat stepper since billing revamp Step 6 — seats are invite-driven
 * derived state (each accepted creator/admin invite bills, removals
 * credit); the section shows them read-only. Billing mutations
 * (checkout, portal) are admin/owner-only.
 */
export function BillingSection({ onGoToMembers }: { onGoToMembers?: () => void }) {
    const { hasActivePlan, subscription, workspaceId, workspaceRole } = useWorkspaceStore();
    const entitlements = useEntitlements();
    const { userId, email, isAuthenticated } = useUserStore();
    const { addToast } = useToast();

    const isAdmin = workspaceRole === 'admin';

    // ── Checkout flow state ───────────────────────────────────────────────────
    const [billingInterval, setBillingInterval] = useState<BillingInterval>('yearly');
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [checkingStatus,  setCheckingStatus]  = useState(false);
    const [checkoutSuccess, setCheckoutSuccess] = useState(false);
    const [checkoutError,   setCheckoutError]   = useState<string | null>(null);

    // ── Manage portal state ───────────────────────────────────────────────────
    const [manageLoading, setManageLoading] = useState(false);

    const isTrialing = entitlements.state === 'trial';
    const isActive   = hasActivePlan && subscription?.status === 'active';

    const currentSeats = subscription?.seats ?? 1;

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
            }
        }, 1000);
        return () => clearInterval(poll);
    }, [checkingStatus, userId, checkoutSuccess]);

    // ── Handlers ──────────────────────────────────────────────────────────────
    const handleCheckout = async () => {
        if (!isAuthenticated || !userId || !email || hasActivePlan) return;
        setCheckoutLoading(true);
        setCheckoutError(null);
        const { error: err } = await StripeService.createCheckoutSession(userId, email, billingInterval, workspaceId);
        setCheckoutLoading(false);
        if (err) {
            setCheckoutError(err.message || 'Failed to start checkout. Please try again.');
        } else {
            setCheckingStatus(true);
        }
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
    const planSeatPrice = subscription?.billingInterval === 'yearly' ? PRICE_YEARLY : PRICE_MONTHLY;

    return (
        <div className="w-full flex flex-col gap-8">
            <div>
                <h2 className="heading-2 mb-1">Plans & Billing</h2>
                <p className="text-sm text-text-muted">Manage your plan and payment details.</p>
            </div>

            {/* ── Current plan status ── */}
            <div className="border border-border rounded-lg p-5 flex flex-col gap-5">

                {/* Plan name + manage button */}
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <p className="text-xs text-text-muted uppercase tracking-wide">Current plan</p>
                        <p className="text-sm font-bold text-text-highlighted">
                            {isTrialing ? 'Pro (Trial)' : entitlements.state === 'free' ? 'Free' : 'Pro'}
                            {hasActivePlan && subscription != null && (
                                <span className="text-text-muted ml-1.5">· {subscription.seats} seat{subscription.seats !== 1 ? 's' : ''}</span>
                            )}
                        </p>
                        {isTrialing && entitlements.trialEndsAt && (
                            <p className="text-xs text-text-muted">
                                Trial ends {new Date(entitlements.trialEndsAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                            </p>
                        )}
                        <TrialExtendLink className="self-start" />
                        {hasActivePlan && !isTrialing && subscription?.currentPeriodEnd && (
                            <p className="text-xs text-text-muted">
                                {subscription.cancelAt ? 'Access until' : 'Renews'}{' '}
                                {new Date(subscription.cancelAt ?? subscription.currentPeriodEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                                {subscription.billingInterval && (
                                    <span className="ml-1 capitalize">· {subscription.billingInterval}</span>
                                )}
                            </p>
                        )}
                    </div>
                    {hasActivePlan && subscription?.stripeCustomerId && isAdmin && (
                        <Button variant="base" onClick={handleManage} disabled={manageLoading}>
                            <LuCreditCard className="icon-sm" />
                            {manageLoading ? 'Loading…' : 'Manage billing'}
                        </Button>
                    )}
                </div>

                {/* ── Seats (read-only — invite-driven since revamp Step 6) ── */}
                {isActive && (
                    <div className="flex flex-col gap-1.5 pt-4 border-t border-border">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-text-muted">Seats</span>
                            <span className="text-sm font-bold text-text-highlighted">
                                {currentSeats} × ${planSeatPrice} = ${currentSeats * planSeatPrice}/mo
                                {subscription?.billingInterval === 'yearly' ? ', billed yearly' : ''}
                            </span>
                        </div>
                        <p className="text-xs text-text-muted">
                            Seats adjust automatically as members join or leave.{' '}
                            {isAdmin && (
                                <button type="button" onClick={onGoToMembers} className="underline hover:text-text-main cursor-pointer">
                                    Manage members
                                </button>
                            )}
                        </p>
                    </div>
                )}

                {/* Non-admins can see the plan, not manage it (revamp Step 6) */}
                {hasActivePlan && !isAdmin && (
                    <p className="text-xs text-text-muted">Only workspace admins can manage billing.</p>
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
                 Admin/owner-only: checkout is a billing mutation (revamp Step 6) ── */}
            {!hasActivePlan && !isAdmin && (
                <p className="text-sm text-text-muted">Only workspace admins can manage billing.</p>
            )}
            {!hasActivePlan && isAdmin && (
                <div className="border border-border rounded-lg p-5 flex flex-col gap-4">
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
