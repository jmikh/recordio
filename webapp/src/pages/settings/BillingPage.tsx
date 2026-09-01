import { useState, useEffect } from 'react';
import { LuLoader, LuCheck, LuX, LuCreditCard, LuShieldCheck } from 'react-icons/lu';
import { Button } from '@shared/components';
import { AuthManager } from '../../auth/AuthManager';
import { invokeFunction } from '../../api/client';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useUserStore } from '../../auth/useUserStore';
import { useEntitlements } from '../../billing/useEntitlements';
import { TrialExtendLink } from '../../billing/TrialExtendLink';
import { useToast } from '../../components/Toast';
import { StripeService, SubscriptionChangePreview } from '../../billing/StripeService';
import type { BillingInterval } from './types';
import { trackBillingPageLoaded } from '../../analytics';

// ─── Constants ────────────────────────────────────────────────────────────────

// Single per-seat plan (billing revamp Step 1)
const PRICE_MONTHLY = 15;
const PRICE_YEARLY  = 12;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysUntil(isoDate: string): number {
    return Math.max(1, Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86_400_000));
}

function prorationLabel(seatDelta: number, nextRenewalDate: string): string {
    const days = daysUntil(nextRenewalDate);
    const abs  = Math.abs(seatDelta);
    const prefix = seatDelta > 0 ? `+${abs}` : `-${abs}`;
    return `${prefix} seat${abs !== 1 ? 's' : ''} · ${days} day${days !== 1 ? 's' : ''} remaining`;
}

function formatCurrency(amount: number, currency = 'usd') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency.toUpperCase(),
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BillingPage({ seatFloor = 1, onGoToMembers }: { seatFloor?: number; onGoToMembers?: () => void }) {
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

    // ── Seat change state ─────────────────────────────────────────────────────
    const [pendingSeats,   setPendingSeats]   = useState<number | null>(null);
    const [preview,        setPreview]        = useState<SubscriptionChangePreview | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [changeApplying, setChangeApplying] = useState(false);
    const [changeError,    setChangeError]    = useState<string | null>(null);
    const [changeSuccess,  setChangeSuccess]  = useState(false);

    const isTrialing = entitlements.state === 'trial';
    const isActive   = hasActivePlan && subscription?.status === 'active';

    const currentSeats   = subscription?.seats ?? 1;
    const displaySeats   = pendingSeats ?? currentSeats;
    const hasPendingChange = isActive && pendingSeats !== null && pendingSeats !== currentSeats;

    useEffect(() => { trackBillingPageLoaded(workspaceId); }, []);

    // ── Fetch preview whenever pending seat count changes ────────────────────
    useEffect(() => {
        if (!workspaceId) return;
        if (!hasPendingChange) {
            setPreview(null);
            return;
        }

        setPreviewLoading(true);
        setPreview(null);
        setChangeError(null);

        const timer = setTimeout(async () => {
            const result = await StripeService.subscriptionChange({
                workspaceId,
                newSeats: pendingSeats!,
                dryRun:   true,
            });
            setPreviewLoading(false);
            if (result.preview) {
                setPreview(result.preview);
            } else {
                setChangeError(result.error?.message ?? 'Failed to load preview');
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [pendingSeats, hasPendingChange, workspaceId]);

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

    const handleConfirmChange = async () => {
        if (!workspaceId || pendingSeats === null) return;
        setChangeApplying(true);
        setChangeError(null);
        const result = await StripeService.subscriptionChange({
            workspaceId,
            newSeats: pendingSeats,
            dryRun:   false,
        });
        setChangeApplying(false);
        if (result.error) {
            setChangeError(result.error.message ?? 'Failed to apply change');
            return;
        }
        setChangeSuccess(true);
        setPendingSeats(null);
        setPreview(null);
        await AuthManager.refreshSubscription();
        setTimeout(() => setChangeSuccess(false), 4000);
    };

    const handleCancelChange = () => {
        setPendingSeats(null);
        setPreview(null);
        setChangeError(null);
    };

    const confirmLabel = () => {
        if (!pendingSeats) return 'Confirm';
        const delta = pendingSeats - currentSeats;
        return delta > 0
            ? `Add ${delta} seat${delta !== 1 ? 's' : ''}`
            : `Remove ${Math.abs(delta)} seat${Math.abs(delta) !== 1 ? 's' : ''}`;
    };

    const seatPrice = billingInterval === 'monthly' ? PRICE_MONTHLY : PRICE_YEARLY;
    const savings   = Math.round((1 - PRICE_YEARLY / PRICE_MONTHLY) * 100);

    return (
        <div className="w-full max-w-3xl flex flex-col gap-8">
            <div>
                <h2 className="text-base font-semibold text-text-highlighted mb-1">Plans & Billing</h2>
                <p className="text-sm text-text-muted">Manage your plan and payment details.</p>
            </div>

            {/* ── Current plan status ── */}
            <div className="border border-border rounded-lg p-5 flex flex-col gap-5">

                {/* Plan name + manage button */}
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <p className="text-xs text-text-muted uppercase tracking-wide font-medium">Current plan</p>
                        <p className="text-sm font-semibold text-text-highlighted">
                            {isTrialing ? 'Pro (Trial)' : entitlements.state === 'free' ? 'Free' : 'Pro'}
                            {hasActivePlan && subscription != null && (
                                <span className="text-text-muted font-normal ml-1.5">· {subscription.seats} seat{subscription.seats !== 1 ? 's' : ''}</span>
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
                    {hasActivePlan && subscription?.stripeCustomerId && (
                        <Button variant="base" onClick={handleManage} disabled={manageLoading}>
                            <LuCreditCard className="icon-sm" />
                            {manageLoading ? 'Loading…' : 'Manage billing'}
                        </Button>
                    )}
                </div>

                {/* ── Seat stepper ── */}
                {isActive && isAdmin && !changeSuccess && (
                    <div className="flex flex-col gap-3 pt-1 border-t border-border">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-text-muted font-medium">Seats</span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPendingSeats(Math.max(seatFloor, displaySeats - 1))}
                                    disabled={displaySeats <= seatFloor}
                                    className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-sm text-text-main hover:bg-state-hover disabled:opacity-30 disabled:cursor-default transition-colors"
                                >−</button>
                                <span className="text-sm font-semibold text-text-highlighted w-6 text-center">{displaySeats}</span>
                                <button
                                    type="button"
                                    onClick={() => setPendingSeats(displaySeats + 1)}
                                    className="w-7 h-7 rounded-md border border-border flex items-center justify-center text-sm text-text-main hover:bg-state-hover transition-colors"
                                >+</button>
                            </div>
                        </div>
                        {displaySeats <= seatFloor && seatFloor > 1 && (
                            <p className="text-xs text-text-muted">
                                {seatFloor} seat{seatFloor !== 1 ? 's' : ''} in use.{' '}
                                <button type="button" onClick={onGoToMembers} className="underline hover:text-text-main">
                                    Remove members
                                </button>{' '}
                                to reduce seats.
                            </p>
                        )}

                        {/* Preview panel */}
                        {hasPendingChange && (
                            <div className="bg-surface-raised border border-border rounded-lg p-4 flex flex-col gap-3">
                                {previewLoading && (
                                    <p className="text-xs text-text-muted flex items-center gap-1.5">
                                        <LuLoader className="icon-sm animate-spin" /> Calculating…
                                    </p>
                                )}
                                {preview && !previewLoading && (
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-text-muted">
                                                {preview.immediateCharge > 0 ? 'Charged today' : preview.immediateCharge < 0 ? 'Credit applied' : 'No charge today'}
                                                {(() => {
                                                    const delta = (pendingSeats ?? currentSeats) - currentSeats;
                                                    return delta > 0 && (
                                                        <span className="block text-[10px] opacity-70">
                                                            {prorationLabel(delta, preview.nextRenewalDate)}
                                                        </span>
                                                    );
                                                })()}
                                            </span>
                                            <span className="font-semibold text-text-highlighted">
                                                {preview.immediateCharge !== 0
                                                    ? formatCurrency(Math.abs(preview.immediateCharge), preview.currency)
                                                    : '—'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-text-muted">
                                                Next renewal · {new Date(preview.nextRenewalDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </span>
                                            <span className="font-semibold text-text-highlighted">
                                                {formatCurrency(preview.nextRenewalAmount, preview.currency)}/{preview.billingInterval === 'yearly' ? 'yr' : 'mo'}
                                            </span>
                                        </div>
                                    </div>
                                )}
                                {changeError && (
                                    <p className="text-xs text-destructive">{changeError}</p>
                                )}
                                <div className="flex items-center gap-2 pt-1">
                                    <Button variant="ghost" onClick={handleCancelChange} disabled={changeApplying}>Cancel</Button>
                                    <Button
                                        variant="primary"
                                        onClick={handleConfirmChange}
                                        disabled={changeApplying || previewLoading || !preview}
                                    >
                                        {changeApplying ? 'Applying…' : confirmLabel()}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Success feedback ── */}
                {changeSuccess && (
                    <div className="bg-success/10 border border-success/30 rounded-md px-3 py-2 text-xs text-success flex items-center gap-2">
                        <LuCheck className="icon-sm shrink-0" />
                        Seats updated successfully.
                    </div>
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

            {/* ── Pricing header: label + interval toggle ── */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-highlighted">Change your plan</h3>
                <div className="flex items-center gap-1 bg-state-inactive rounded-full p-1">
                    {(['monthly', 'yearly'] as BillingInterval[]).map(iv => (
                        <button
                            key={iv}
                            onClick={() => setBillingInterval(iv)}
                            className={`py-1.5 px-4 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${
                                billingInterval === iv
                                    ? 'bg-primary text-text-on-primary shadow-sm'
                                    : 'text-text-muted hover:text-text-main'
                            }`}
                        >
                            {iv === 'monthly' ? 'Monthly' : 'Annual'}
                            {iv === 'yearly' && (
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
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

            {/* ── Pricing cards ── */}
            <div className="grid grid-cols-2 gap-4">

                {/* Free */}
                <div className={`border-2 rounded-xl p-5 flex flex-col gap-4 relative ${entitlements.state === 'free' ? 'border-primary' : 'border-border'}`}>
                    {entitlements.state === 'free' && (
                        <span className="absolute -top-3 right-4 bg-primary text-text-on-primary text-[10px] font-bold px-2.5 py-1 rounded-full uppercase">
                            Current plan
                        </span>
                    )}
                    <div>
                        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Free</h3>
                        <div className="mb-0.5">
                            <span className="text-2xl font-bold text-text-highlighted">$0</span>
                            <span className="text-xs text-text-muted ml-1">/ forever</span>
                        </div>
                        <p className="text-xs text-text-muted">No card needed</p>
                    </div>
                    {entitlements.state !== 'free' && (
                        <div className="py-1.5 px-3 rounded-full bg-state-inactive text-text-disabled text-xs font-medium text-center">
                            Not available
                        </div>
                    )}
                    <p className="text-xs text-text-muted">For one-off projects</p>
                </div>

                {/* Pro */}
                <div className={`border-2 rounded-xl p-5 flex flex-col gap-4 relative ${isActive ? 'border-primary' : 'border-border'}`}>
                    {isActive && (
                        <span className="absolute -top-3 right-4 bg-primary text-text-on-primary text-[10px] font-bold px-2.5 py-1 rounded-full uppercase">
                            Current plan
                        </span>
                    )}
                    <div>
                        <h3 className="text-xs font-semibold text-primary uppercase tracking-wide mb-3">Pro</h3>
                        <div className="mb-0.5">
                            <span className="text-2xl font-bold text-text-highlighted">${seatPrice}</span>
                            <span className="text-xs text-text-muted ml-1">/ seat / month</span>
                        </div>
                        <p className="text-xs text-text-muted">{billingInterval === 'yearly' ? 'Billed annually' : 'Billed monthly'}</p>
                    </div>
                    {!hasActivePlan ? (
                        <Button variant="primary" fullWidth onClick={handleCheckout} disabled={checkoutLoading || checkingStatus}>
                            {checkoutLoading ? 'Loading…' : checkingStatus ? 'Waiting…' : 'Upgrade to Pro'}
                        </Button>
                    ) : (
                        <div className="py-1.5 px-3 rounded-full bg-state-inactive text-text-muted text-xs font-medium text-center">
                            Current plan
                        </div>
                    )}
                    <p className="text-xs text-text-muted">Solo or with your team — seats scale as you invite</p>
                </div>
            </div>

            {/* ── Feature comparison table ── */}
            <div className="border border-border rounded-xl overflow-hidden">
                <div className="grid grid-cols-3 px-4 py-3 bg-surface-raised border-b border-border">
                    <span className="text-xs font-semibold text-text-highlighted">Feature</span>
                    <span className="text-xs font-semibold text-text-muted text-center">Free</span>
                    <span className="text-xs font-semibold text-primary text-center">Pro</span>
                </div>
                {[
                    { category: 'Recording' },
                    { label: 'Record + edit',                  free: true,      pro: true      },
                    { label: 'DOM-aware auto-zoom',            free: true,      pro: true      },
                    { category: 'Rendering & Transcription' },
                    { label: 'In-browser export (1080p)',      free: true,      pro: true      },
                    { label: 'Background export',              free: false,     pro: true      },
                    { label: '4K export',                      free: false,     pro: true      },
                    { label: 'Transcription',                  free: 'Local',   pro: 'OpenAI'  },
                    { label: 'Restore deleted videos',         free: false,     pro: '30 days' },
                    { category: 'Editing' },
                    { label: 'Remove silences',                free: true,      pro: true      },
                    { label: 'Background presets',             free: true,      pro: true      },
                    { label: 'Custom background upload',       free: false,     pro: true      },
                    { label: 'Captions-based editing',         free: false,     pro: true      },
                    { label: 'Word-by-word caption highlight', free: false,     pro: true      },
                    { category: 'Sharing & Collaboration' },
                    { label: 'Share video by link',            free: false,     pro: true      },
                    { label: 'Team workspace',                 free: false,     pro: true      },
                    { label: 'Role-based access',              free: false,     pro: true      },
                ].map((row, i) => {
                    if ('category' in row) {
                        return (
                            <div key={i} className="px-4 py-2 bg-surface-raised border-b border-border">
                                <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{row.category}</span>
                            </div>
                        );
                    }
                    const cell = (val: string | boolean) => {
                        if (val === true)  return <LuCheck className="icon-sm text-success mx-auto" />;
                        if (val === false) return <LuX className="icon-sm text-text-disabled mx-auto" />;
                        return <span className="text-xs text-text-main">{val}</span>;
                    };
                    return (
                        <div key={i} className="grid grid-cols-3 px-4 py-2.5 border-b border-border last:border-b-0 items-center hover:bg-state-hover transition-colors">
                            <span className="text-xs text-text-main">{row.label}</span>
                            <div className="flex justify-center">{cell(row.free)}</div>
                            <div className="flex justify-center">{cell(row.pro)}</div>
                        </div>
                    );
                })}
            </div>

            {/* Trust line */}
            <div className="flex items-center gap-4 text-xs text-text-muted">
                <span className="flex items-center gap-1"><LuShieldCheck className="icon-sm" /> Secure with Stripe</span>
                <span>Cancel anytime</span>
            </div>
        </div>
    );
}
