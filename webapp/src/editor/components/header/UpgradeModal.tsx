import { useState, useEffect } from 'react';
import { LuCheck, LuSettings } from 'react-icons/lu';
import { BiCrown } from 'react-icons/bi';
import { XButton, Modal, Button } from '@shared/components';
import { StripeService } from '../../stripe/StripeService';
import { useUserStore } from '../../stores/useUserStore';
import { supabase } from '../../../auth/AuthManager';
import { trackUpgradeModalViewed, trackUpgradeModalDismissed, trackGetProClicked } from '../../../core/analytics';

interface UpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSignInRequest: () => void;
    selectedQuality?: string | null;
    initialInterval?: BillingInterval;
    autoCheckout?: boolean;
}

type BillingInterval = 'monthly' | 'yearly' | 'lifetime';

export function UpgradeModal({ isOpen, onClose, onSignInRequest, selectedQuality, initialInterval, autoCheckout }: UpgradeModalProps) {
    const [loading, setLoading] = useState(false);
    const [checkingStatus, setCheckingStatus] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [billingInterval, setBillingInterval] = useState<BillingInterval>(initialInterval ?? 'yearly');
    const { userId, email, isAuthenticated, isPro, subscription } = useUserStore();

    // Active paid subscriber (not trialing)
    const isActiveSubscriber = isPro && subscription.status === 'active';

    // Poll for subscription status after checkout opens
    useEffect(() => {
        if (!isOpen || !checkingStatus || !userId || success) return;

        const pollInterval = setInterval(async () => {
            if (!supabase) return;

            // Check if user has active subscription via RPC
            const { data, error } = await supabase.rpc('subscription_get');

            // Ignore errors — expected while waiting for webhook to create subscription
            if (error || !data) return;

            if (data?.status === 'active') {
                setSuccess(true);
                setCheckingStatus(false);

                // Reload user store to pick up Pro status
                const { setSubscription } = useUserStore.getState();
                setSubscription({
                    status: 'active',
                    planId: data.plan_id || '',
                    currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : new Date(),
                    cancelAtPeriodEnd: data.cancel_at_period_end || false,
                    stripeCustomerId: data.stripe_customer_id || null,
                    billingInterval: data.billing_interval || null
                });

                // Auto-close after showing success message
                setTimeout(() => {
                    onClose();
                }, 2000);
            }
        }, 1000); // Check every second

        return () => clearInterval(pollInterval);
    }, [isOpen, checkingStatus, userId, success, onClose]);

    // Reset states when modal closes
    useEffect(() => {
        if (!isOpen) {
            setLoading(false);
            setCheckingStatus(false);
            setSuccess(false);
            setError(null);
        } else {
            trackUpgradeModalViewed();
        }
    }, [isOpen]);



    const handleClose = () => {
        trackUpgradeModalDismissed();
        onClose();
    };

    const handleUpgrade = async () => {
        if (!userId || !email) {
            onClose();
            onSignInRequest();
            return;
        }

        trackGetProClicked(billingInterval);
        setLoading(true);
        setError(null);

        const { error: checkoutError } = await StripeService.createCheckoutSession(userId, email, billingInterval);

        if (checkoutError) {
            setError(checkoutError.message || 'Failed to start checkout. Please try again.');
            setLoading(false);
        } else {
            // Checkout opened successfully, start polling
            setLoading(false);
            setCheckingStatus(true);
        }
    };

    const handleManageSubscription = async () => {
        if (!subscription.stripeCustomerId) {
            console.error('[UpgradeModal] No Stripe customer ID found');
            return;
        }

        setLoading(true);
        const { url, error } = await StripeService.createPortalSession(subscription.stripeCustomerId);
        setLoading(false);

        if (error || !url) {
            console.error('[UpgradeModal] Failed to create portal session:', error);
            return;
        }

        window.open(url, '_blank');
    };

    const monthlyPrice = 15;
    const yearlyPrice = 48;
    const yearlyMonthlyEquivalent = Math.round(yearlyPrice / 12);
    const savingsPercent = Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100);
    const isLifetimeSubscriber = isPro && subscription.billingInterval === 'lifetime';

    // ── Already-Pro View ──
    if (isActiveSubscriber) {
        return (
            <Modal isOpen={isOpen} onClose={handleClose} maxWidth="max-w-[380px]" className="!bg-surface !shadow-[0_0_30px_-5px_var(--color-primary)]">
                <div className="flex justify-end mb-2">
                    <XButton onClick={handleClose} title="Close" />
                </div>

                {/* Pro Title */}
                <h2 className="text-2xl font-bold text-text-highlighted text-center mb-6 flex items-center justify-center gap-2">
                    Recordio
                    <span className="bg-primary text-text-on-primary text-xs font-bold px-2.5 py-1 rounded-full uppercase">
                        Pro
                    </span>
                </h2>

                {/* Crown + Message */}
                <div className="flex flex-col items-center gap-3 mb-6">
                    <BiCrown className="text-primary" size={48} />
                    <p className="text-lg font-semibold text-text-highlighted text-center">
                        You're already a Pro member
                    </p>
                    <p className="text-sm text-text-muted text-center">
                        You have full access to all Pro features including unlimited 4K exports and shareable links.
                    </p>
                </div>

                {/* Subscription Info */}
                {isLifetimeSubscriber ? (
                    <div className="bg-surface rounded-lg px-4 py-3 mb-6 text-center">
                        <p className="text-xs text-text-muted">Plan</p>
                        <p className="text-sm text-text-highlighted font-medium mt-0.5">Lifetime access — no renewal needed</p>
                    </div>
                ) : subscription.currentPeriodEnd && (
                    <div className="bg-surface rounded-lg px-4 py-3 mb-6 text-center">
                        <p className="text-xs text-text-muted">
                            {subscription.cancelAtPeriodEnd ? 'Access until' : 'Next billing date'}
                        </p>
                        <p className="text-sm text-text-highlighted font-medium mt-0.5">
                            {new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                    </div>
                )}

                {/* Manage Subscription */}
                {subscription.stripeCustomerId && (
                    <Button
                        variant="primary"
                        onClick={handleManageSubscription}
                        disabled={loading}
                        fullWidth
                        className="py-3 text-base font-semibold rounded-lg"
                    >
                        <LuSettings className="icon-sm" />
                        {loading ? 'Loading...' : 'Manage Subscription'}
                    </Button>
                )}

                <button
                    onClick={handleClose}
                    className="w-full py-2.5 mt-2 text-sm text-text-muted hover:text-text-main transition-colors rounded-lg"
                >
                    Close
                </button>
            </Modal>
        );
    }

    // ── Standard Upgrade Flow ──

    const handleUpgradeWithInterval = async (interval: BillingInterval) => {
        if (!userId || !email) {
            onClose();
            onSignInRequest();
            return;
        }

        trackGetProClicked(interval);
        setLoading(true);
        setError(null);

        const { error: checkoutError } = await StripeService.createCheckoutSession(userId, email, interval);

        if (checkoutError) {
            setError(checkoutError.message || 'Failed to start checkout. Please try again.');
            setLoading(false);
        } else {
            setLoading(false);
            setCheckingStatus(true);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} maxWidth="max-w-[740px]" className="!bg-surface !shadow-[0_0_30px_-5px_var(--color-primary)]">
            {/* Header */}
            <div className="flex justify-end mb-2">
                <XButton onClick={handleClose} title="Close" />
            </div>

            {/* Success Message */}
            {success && (
                <div className="mb-6 bg-success/10 border border-success/30 rounded-sm p-4 text-center">
                    <LuCheck className="text-success mx-auto mb-2" size={32} />
                    <p className="text-lg font-semibold text-success mb-1">
                        🎉 Welcome to Pro!
                    </p>
                    <p className="text-sm text-text-muted">
                        Your subscription is now active. Enjoy unlimited exports!
                    </p>
                </div>
            )}

            {/* Checking Status Message */}
            {checkingStatus && !success && (
                <div className="mb-6 bg-primary/10 border border-primary/30 rounded-sm p-3 text-center">
                    <p className="text-sm text-text-highlighted">
                        ⏳ Waiting for payment completion...
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                        Complete payment in the checkout tab, then return here
                    </p>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="mb-4 bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-sm text-xs">
                    {error}
                </div>
            )}

            {/* Temporarily unavailable notice */}
            <div className="flex flex-col items-center gap-4 py-8 px-4">
                <BiCrown className="text-primary" size={40} />
                <p className="text-base font-semibold text-text-highlighted text-center">
                    Upgrades temporarily unavailable
                </p>
                <p className="text-sm text-text-muted text-center max-w-[360px] leading-relaxed">
                    We're restructuring our product and pricing. Upgrades will be back soon — check back in a few days!
                </p>
            </div>

            {/* Two-Card Layout — hidden during product restructuring */}
            {false && <div className="flex gap-4">
                {/* ── Pro Card ── */}
                <div className="flex-1 border border-border rounded-xl p-6 flex flex-col bg-surface-raised shadow-lg">
                    <h3 className="text-xl font-bold text-text-highlighted text-center mb-5">Pro</h3>

                    {/* Price */}
                    <div className="text-center mb-1">
                        <span className="text-4xl font-bold text-primary">
                            ${billingInterval === 'monthly' ? monthlyPrice : yearlyPrice}
                        </span>
                        {billingInterval === 'yearly' && (
                            <span className="text-sm text-text-muted ml-1">/ year</span>
                        )}
                        {billingInterval === 'monthly' && (
                            <span className="text-sm text-text-muted ml-1">/ month</span>
                        )}
                    </div>
                    <p className="text-xs text-text-muted text-center mb-5">
                        {billingInterval === 'yearly'
                            ? `Just $${yearlyMonthlyEquivalent}/month`
                            : `$${yearlyPrice}/year with annual billing`
                        }
                    </p>

                    {/* Monthly / Annual Toggle */}
                    <div className="flex items-center justify-center gap-1 mb-6 bg-surface rounded-full p-1 mx-auto w-fit">
                        <button
                            onClick={() => setBillingInterval('monthly')}
                            className={`py-1.5 px-4 text-xs font-medium rounded-full transition-all ${billingInterval === 'monthly'
                                ? 'bg-primary text-text-on-primary shadow-sm'
                                : 'text-text-muted hover:text-text-main'
                                }`}
                        >
                            Monthly
                        </button>
                        <button
                            onClick={() => setBillingInterval('yearly')}
                            className={`py-1.5 px-4 text-xs font-medium rounded-full transition-all ${billingInterval === 'yearly'
                                ? 'bg-primary text-text-on-primary shadow-sm'
                                : 'text-text-muted hover:text-text-main'
                                }`}
                        >
                            Annual -{savingsPercent}%
                        </button>
                    </div>

                    {/* Feature List */}
                    <ul className="space-y-3 mb-6 flex-1">
                        <li className="flex items-center gap-3 text-sm">
                            <LuCheck className="icon-sm text-primary shrink-0" />
                            <span className="text-text-highlighted font-medium">Everything in Free, plus:</span>
                        </li>
                        <li className="flex items-center gap-3 text-sm">
                            <LuCheck className="icon-sm text-primary shrink-0" />
                            <span className="text-text-highlighted">Unlimited 4K exports</span>
                        </li>
                        <li className="flex items-center gap-3 text-sm">
                            <LuCheck className="icon-sm text-primary shrink-0" />
                            <span className="text-text-highlighted">Shareable links</span>
                        </li>
                    </ul>

                    {/* Get Pro Button */}
                    <Button
                        variant="primary"
                        onClick={() => handleUpgradeWithInterval(billingInterval === 'monthly' ? 'monthly' : 'yearly')}
                        fullWidth
                        className="py-3 text-sm font-semibold rounded-lg"
                        disabled={loading}
                    >
                        {loading ? 'Loading...' : !isAuthenticated ? 'Sign in & Get Pro' : 'Get Pro'}
                    </Button>
                </div>
            </div>}

            {false && <p className="text-center text-xs text-text-muted mt-4">
                Secure payment processed by Stripe
            </p>}
        </Modal>
    );
}
