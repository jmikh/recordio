import { useState, useEffect } from 'react';
import { LuCheck, LuSettings, LuShieldCheck } from 'react-icons/lu';
import { BiCrown } from 'react-icons/bi';
import { XButton, Modal, Button, LogoLink } from '@shared/components';
import { StripeService } from '../../stripe/StripeService';
import { useUserStore } from '../../stores/useUserStore';
import { useWorkspaceStore } from '../../../stores/useWorkspaceStore';
import { supabase, AuthManager } from '../../../auth/AuthManager';
import { trackUpgradeModalViewed, trackUpgradeModalDismissed, trackGetProClicked } from '../../../core/analytics';

interface UpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSignInRequest: () => void;
    selectedQuality?: string | null;
    initialInterval?: BillingInterval;
    autoCheckout?: boolean;
}

type BillingInterval = 'monthly' | 'yearly';

export function UpgradeModal({ isOpen, onClose, onSignInRequest, selectedQuality, initialInterval, autoCheckout }: UpgradeModalProps) {
    const [loading, setLoading] = useState(false);
    const [checkingStatus, setCheckingStatus] = useState(false);
    const [success, setSuccess] = useState(false);
    const [trialSuccess, setTrialSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [billingInterval, setBillingInterval] = useState<BillingInterval>(initialInterval ?? 'yearly');
    const { userId, email, isAuthenticated, hasFreeTrial } = useUserStore();
    const { hasActivePlan, subscription } = useWorkspaceStore();

    // Active paid subscriber (not trialing)
    const isActiveSubscriber = hasActivePlan && subscription?.status === 'active';

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

                // Reload workspace store to pick up subscription + Pro status
                await AuthManager.refreshSubscription();

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
            setTrialSuccess(false);
            setError(null);
        } else {
            trackUpgradeModalViewed();
        }
    }, [isOpen]);



    const handleClose = () => {
        trackUpgradeModalDismissed();
        onClose();
    };

    const handleManageSubscription = async () => {
        if (!subscription?.stripeCustomerId) {
            console.error('[UpgradeModal] No Stripe customer ID found');
            return;
        }

        setLoading(true);
        const { url, error } = await StripeService.createPortalSession();
        setLoading(false);

        if (error || !url) {
            console.error('[UpgradeModal] Failed to create portal session:', error);
            return;
        }

        window.open(url, '_blank');
    };

    const handleStartTrial = async () => {
        if (!isAuthenticated) {
            onClose();
            onSignInRequest();
            return;
        }
        if (!supabase) return;

        setLoading(true);
        setError(null);

        const { error: rpcError } = await supabase.rpc('trial_start');

        setLoading(false);

        if (rpcError) {
            setError(rpcError.message || 'Failed to start trial. Please try again.');
            return;
        }

        // Reload trial state in user store
        const { setTrialEndsAt } = useUserStore.getState();
        setTrialEndsAt(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
        setTrialSuccess(true);

        setTimeout(() => {
            onClose();
        }, 2000);
    };

    const monthlyPrice = 15;
    const yearlyMonthlyPrice = 12;
    const yearlyPrice = yearlyMonthlyPrice * 12;
    const savingsPercent = Math.round((1 - yearlyMonthlyPrice / monthlyPrice) * 100);
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
                {subscription?.currentPeriodEnd && (
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
                {subscription?.stripeCustomerId && (
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

    const displayPrice = billingInterval === 'monthly' ? monthlyPrice : yearlyMonthlyPrice;

    const freeFeatures = [
        'Auto-zooms, auto cut silences & more',
        'Up to 5 recordings',
        'Video expires after 7 days',
        'Transcription via small local model',
        'Rendering in the browser (tab must stay in focus)',
    ];

    const proFeatures = [
        'Everything in Free',
        'Cloud rendering',
        'Unlimited recordings',
        'Transcription via top OpenAI model',
        'No video expiration',
        'Restore deleted videos within 30 days',
    ];

    return (
        <Modal isOpen={isOpen} onClose={handleClose} maxWidth="max-w-[700px]" className="!bg-surface !shadow-[0_0_30px_-5px_var(--color-primary)]">
            {/* Header */}
            <div className="flex justify-end mb-2">
                <XButton onClick={handleClose} title="Close" />
            </div>

            {/* Success Message */}
            {(success || trialSuccess) && (
                <div className="mb-6 bg-primary/10 border border-primary/30 rounded-sm p-4 text-center">
                    <LuCheck className="text-primary mx-auto mb-2" size={32} />
                    <p className="text-lg font-semibold text-text-highlighted mb-1">
                        {trialSuccess ? 'Welcome to your Pro trial!' : 'Welcome to Pro!'}
                    </p>
                    <p className="text-sm text-text-muted">
                        {trialSuccess
                            ? 'Your 7-day trial is now active. Enjoy all Pro features!'
                            : 'Your subscription is now active. Enjoy all Pro features!'
                        }
                    </p>
                </div>
            )}

            {/* Checking Status Message */}
            {checkingStatus && !success && (
                <div className="mb-6 bg-primary/10 border border-primary/30 rounded-sm p-3 text-center">
                    <p className="text-sm text-text-highlighted">
                        Waiting for payment completion...
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

            {/* Logo */}
            <div className="flex justify-center mb-5">
                <LogoLink imgClassName="h-8" />
            </div>

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
                    className={`py-1.5 px-4 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 ${billingInterval === 'yearly'
                        ? 'bg-primary text-text-on-primary shadow-sm'
                        : 'text-text-muted hover:text-text-main'
                        }`}
                >
                    Annual
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${billingInterval === 'yearly'
                        ? 'bg-text-on-primary/20 text-text-on-primary'
                        : 'bg-primary/15 text-primary'
                        }`}>
                        SAVE {savingsPercent}%
                    </span>
                </button>
            </div>

            {/* Two-Column Comparison */}
            <div className="flex gap-4">
                {/* ── Free Column ── */}
                <div className="flex-1 border border-border rounded-xl p-5 flex flex-col">
                    <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-4">Free</h3>

                    <div className="mb-1">
                        <span className="text-3xl font-bold text-text-highlighted">$0</span>
                        <span className="text-sm text-text-muted ml-1">/ forever</span>
                    </div>
                    <p className="text-xs text-text-muted mb-4">No card needed</p>

                    <div className="bg-state-inactive text-text-muted text-xs font-medium px-3 py-1.5 rounded-full w-fit mb-5">
                        Your current plan
                    </div>

                    <ul className="space-y-3 flex-1">
                        {freeFeatures.map((feature) => (
                            <li key={feature} className="flex items-start gap-2.5 text-sm">
                                <LuCheck className="icon-sm text-text-muted shrink-0 mt-0.5" />
                                <span className="text-text-main">{feature}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* ── Pro Column ── */}
                <div className="flex-1 border-2 border-primary rounded-xl p-5 flex flex-col relative">
                    <span className="absolute -top-3 right-4 bg-primary text-text-on-primary text-[10px] font-bold px-2.5 py-1 rounded-full uppercase">
                        Recommended
                    </span>

                    <h3 className="text-sm font-semibold text-primary uppercase tracking-wide mb-4">Pro</h3>

                    <div className="mb-1">
                        <span className="text-3xl font-bold text-primary">${displayPrice}</span>
                        <span className="text-sm text-text-muted ml-1">/ month</span>
                    </div>
                    <p className="text-xs text-text-muted mb-4">
                        {billingInterval === 'yearly'
                            ? 'Billed annually'
                            : 'Billed monthly'
                        }
                    </p>

                    {/* Spacer to align with Free column's "Your current plan" badge */}
                    <div className="h-[30px] mb-5" />

                    <ul className="space-y-3 flex-1">
                        {proFeatures.map((feature) => (
                            <li key={feature} className="flex items-start gap-2.5 text-sm">
                                <LuCheck className="icon-sm text-primary shrink-0 mt-0.5" />
                                <span className="text-text-highlighted">{feature}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* CTA */}
            <div className="mt-6 flex flex-col gap-2">
                <Button
                    variant="primary"
                    onClick={() => handleUpgradeWithInterval(billingInterval)}
                    fullWidth
                    className="py-3 text-sm font-semibold rounded-lg"
                    disabled={loading}
                >
                    {loading ? 'Loading...' : !isAuthenticated ? 'Sign in & Upgrade to Pro' : 'Upgrade to Pro'}
                </Button>

                {!hasFreeTrial() && (
                    <Button
                        variant="ghost"
                        onClick={handleStartTrial}
                        fullWidth
                        className="py-3 text-sm font-semibold rounded-lg"
                        disabled={loading}
                    >
                        Or start a 7-day free trial
                    </Button>
                )}
            </div>

            {/* Trust Badges */}
            <div className="flex items-center justify-center gap-4 mt-2 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                    <LuShieldCheck className="icon-sm" />
                    Secure with Stripe
                </span>
                <span>Cancel anytime</span>
            </div>
        </Modal>
    );
}
