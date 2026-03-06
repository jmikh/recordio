import { useState, useEffect } from 'react';
import { FaCheck, FaCog } from 'react-icons/fa';
import { BiCrown } from 'react-icons/bi';
import { XButton, Modal } from '@shared/components';
import { StripeService } from '../../stripe/StripeService';
import { MAX_SHARED_VIDEOS } from '../../services/ShareService';
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

            // Check if user has active subscription
            // Use maybeSingle() instead of single() to avoid 406 errors when subscription doesn't exist yet
            const { data, error } = await supabase
                .from('subscriptions')
                .select('status, plan_id, current_period_end, cancel_at_period_end, stripe_customer_id, billing_interval')
                .eq('user_id', userId)
                .maybeSingle();

            // Ignore "not found" - it's expected while waiting for webhook to create subscription
            // Only log actual errors (network issues, permission errors, etc.)
            if (error) {
                console.error('[UpgradeModal] Error checking subscription status:', error);
                return;
            }

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
    const lifetimePrice = 89;
    const yearlyMonthlyEquivalent = Math.round(yearlyPrice / 12);
    const savingsPercent = Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100);
    const isLifetime = billingInterval === 'lifetime';
    const isLifetimeSubscriber = isPro && subscription.billingInterval === 'lifetime';

    // ── Already-Pro View ──
    if (isActiveSubscriber) {
        return (
            <Modal isOpen={isOpen} onClose={handleClose} maxWidth="max-w-[380px]" className="!shadow-[0_0_30px_-5px_var(--color-primary)]">
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
                        You have full access to all Pro features including unlimited 4K exports, no watermarks, and shareable links.
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
                    <button
                        onClick={handleManageSubscription}
                        disabled={loading}
                        className="interactive-primary flex items-center justify-center gap-2 w-full py-3 text-base font-semibold rounded-lg"
                    >
                        <FaCog size={14} />
                        {loading ? 'Loading...' : 'Manage Subscription'}
                    </button>
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
    return (
        <Modal isOpen={isOpen} onClose={handleClose} maxWidth="max-w-[380px]" className="!shadow-[0_0_30px_-5px_var(--color-primary)]">
            {/* Header */}
            <div className="flex justify-end mb-2">
                <XButton onClick={handleClose} title="Close" />
            </div>

            {/* Success Message */}
            {success && (
                <div className="mb-6 bg-green-900/20 border border-green-500/50 rounded-sm p-4 text-center">
                    <FaCheck className="text-green-500 mx-auto mb-2" size={32} />
                    <p className="text-lg font-semibold text-green-400 mb-1">
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

            {/* Pro Title */}
            <h2 className="text-2xl font-bold text-text-highlighted text-center mb-6 flex items-center justify-center gap-2">
                Recordio
                <span className="bg-primary text-text-on-primary text-xs font-bold px-2.5 py-1 rounded-full uppercase">
                    Pro
                </span>
            </h2>

            {/* Price Display */}
            <div className="text-center mb-2">
                <span className="text-5xl font-bold text-primary">
                    ${isLifetime ? lifetimePrice : billingInterval === 'monthly' ? monthlyPrice : yearlyMonthlyEquivalent}
                </span>
            </div>
            <p className="text-sm text-text-muted text-center mb-1">
                {isLifetime ? 'one-time' : 'per month'}
            </p>
            <p className="text-xs text-text-muted text-center mb-5">
                {isLifetime
                    ? 'Pay once, yours forever'
                    : billingInterval === 'yearly'
                        ? `Billed at $${yearlyPrice} annually`
                        : 'Billed monthly'
                }
            </p>

            {/* Billing Toggle — pill style */}
            <div className="flex items-center justify-center gap-1 mb-6 bg-surface rounded-full p-1 mx-auto w-fit">
                <button
                    onClick={() => setBillingInterval('monthly')}
                    className={`py-1.5 px-4 text-sm font-medium rounded-full transition-all ${billingInterval === 'monthly'
                        ? 'bg-primary text-text-on-primary shadow-sm'
                        : 'text-text-muted hover:text-text-main'
                        }`}
                >
                    Monthly
                </button>
                <button
                    onClick={() => setBillingInterval('yearly')}
                    className={`py-1.5 px-4 text-sm font-medium rounded-full transition-all ${billingInterval === 'yearly'
                        ? 'bg-primary text-text-on-primary shadow-sm'
                        : 'text-text-muted hover:text-text-main'
                        }`}
                >
                    Annual -{savingsPercent}%
                </button>
                <button
                    onClick={() => setBillingInterval('lifetime')}
                    className={`py-1.5 px-4 text-sm font-medium rounded-full transition-all ${isLifetime
                        ? 'bg-primary text-text-on-primary shadow-sm'
                        : 'text-text-muted hover:text-text-main'
                        }`}
                >
                    Lifetime
                </button>
            </div>

            {/* Feature List */}
            <ul className="space-y-4 mb-6">
                <li className="flex items-center gap-3 text-sm">
                    <FaCheck className="text-yellow-500 shrink-0" size={14} />
                    <span className="text-text-highlighted font-medium">Everything in Free, plus:</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                    <FaCheck className="text-yellow-500 shrink-0" size={14} />
                    <span className="text-text-highlighted">Unlimited 4K exports</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                    <FaCheck className="text-yellow-500 shrink-0" size={14} />
                    <span className="text-text-highlighted">No watermarks</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                    <FaCheck className="text-yellow-500 shrink-0" size={14} />
                    <span className="text-text-highlighted">Shareable links</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                    <FaCheck className="text-yellow-500 shrink-0" size={14} />
                    <span className="text-text-highlighted">Priority support</span>
                </li>
            </ul>



            {/* Error Message */}
            {error && (
                <div className="mb-4 bg-red-900/20 border border-red-500/50 text-red-400 px-3 py-2 rounded-sm text-xs">
                    {error}
                </div>
            )}

            {/* Get Pro Button */}
            <button
                onClick={handleUpgrade}
                className="interactive-primary flex items-center justify-center gap-2 w-full py-3 text-base font-semibold rounded-lg"
                disabled={loading}
            >
                {loading ? 'Loading...' : autoCheckout && isAuthenticated ? 'Continue to Checkout' : !isAuthenticated ? 'Sign in & Get Pro' : 'Get Pro'}
            </button>

            <p className="text-center text-xs text-text-muted mt-4">
                Secure payment processed by Stripe
            </p>
        </Modal>
    );
}
