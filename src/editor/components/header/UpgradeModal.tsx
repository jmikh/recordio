import { useState, useEffect } from 'react';
import { FaCrown, FaCheck, FaTimes } from 'react-icons/fa';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { Button } from '../../../components/ui/Button';
import { XButton } from '../../../components/ui/XButton';
import { StripeService } from '../../stripe/StripeService';
import { useUserStore } from '../../stores/useUserStore';
import { supabase } from '../../../auth/AuthManager';

interface UpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedQuality?: string | null;
}

export function UpgradeModal({ isOpen, onClose, selectedQuality }: UpgradeModalProps) {
    const [loading, setLoading] = useState(false);
    const [checkingStatus, setCheckingStatus] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { userId, email } = useUserStore();

    // Poll for subscription status after checkout opens
    useEffect(() => {
        if (!isOpen || !checkingStatus || !userId || success) return;

        const pollInterval = setInterval(async () => {
            if (!supabase) return;

            // Check if user has active subscription
            // Use maybeSingle() instead of single() to avoid 406 errors when subscription doesn't exist yet
            const { data, error } = await supabase
                .from('subscriptions')
                .select('status, plan_id, current_period_end, cancel_at_period_end, stripe_customer_id')
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
                    stripeCustomerId: data.stripe_customer_id || null
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
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleUpgrade = async () => {
        if (!userId || !email) {
            setError('Please sign in to subscribe');
            return;
        }

        setLoading(true);
        setError(null);

        const { error: checkoutError } = await StripeService.createCheckoutSession(userId, email);

        if (checkoutError) {
            setError(checkoutError.message || 'Failed to start checkout. Please try again.');
            setLoading(false);
        } else {
            // Checkout opened successfully, start polling
            setLoading(false);
            setCheckingStatus(true);
        }
    };

    return (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
            <div className="bg-surface-raised rounded-lg p-6 w-full max-w-[500px] border border-border">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                        <FaCrown className="text-yellow-500" size={24} />
                        <h2 className="text-xl font-semibold text-text-highlighted">
                            Upgrade to Pro
                        </h2>
                    </div>
                    <XButton onClick={onClose} title="Close" />
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

                {selectedQuality && !success && !checkingStatus && (
                    <div className="mb-6 bg-primary/10 border border-primary/30 rounded-sm p-3">
                        <p className="text-sm text-text-highlighted">
                            <strong>{selectedQuality}</strong> exports are only available for Pro subscribers.
                        </p>
                    </div>
                )}

                {/* Pricing Card */}
                <div className="bg-surface rounded-lg p-6 mb-6 border border-border">
                    <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-4xl font-bold text-text-highlighted">$9.99</span>
                        <span className="text-text-muted">/month</span>
                    </div>

                    <ul className="space-y-3">
                        <li className="flex items-start gap-3 text-sm">
                            <FaCheck className="text-green-500 mt-0.5 shrink-0" size={14} />
                            <span className="text-text-main">
                                <strong className="text-text-highlighted">Export in 1080p and 4K</strong> - Crystal clear quality for professional videos
                            </span>
                        </li>
                        <li className="flex items-start gap-3 text-sm">
                            <FaCheck className="text-green-500 mt-0.5 shrink-0" size={14} />
                            <span className="text-text-main">
                                <strong className="text-text-highlighted">No watermarks</strong> - Clean exports at all resolutions
                            </span>
                        </li>
                        <li className="flex items-start gap-3 text-sm">
                            <FaCheck className="text-green-500 mt-0.5 shrink-0" size={14} />
                            <span className="text-text-main">
                                <strong className="text-text-highlighted">Priority support</strong> - Get help when you need it
                            </span>
                        </li>
                        <li className="flex items-start gap-3 text-sm">
                            <FaCheck className="text-green-500 mt-0.5 shrink-0" size={14} />
                            <span className="text-text-main">
                                <strong className="text-text-highlighted">Cancel anytime</strong> - No long-term commitment required
                            </span>
                        </li>
                    </ul>
                </div>

                {/* Free Plan Comparison */}
                <div className="mb-6 p-4 bg-surface rounded-sm border border-border">
                    <p className="text-xs font-medium text-text-muted mb-2">Free Plan Limitations:</p>
                    <ul className="space-y-1">
                        <li className="flex items-center gap-2 text-xs text-text-muted">
                            <FaTimes className="text-red-400" size={10} />
                            <span>360p & 720p only</span>
                        </li>
                        <li className="flex items-center gap-2 text-xs text-text-muted">
                            <FaTimes className="text-red-400" size={10} />
                            <span>Watermark on all exports</span>
                        </li>
                    </ul>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mb-4 bg-red-900/20 border border-red-500/50 text-red-400 px-3 py-2 rounded-sm text-xs">
                        {error}
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3">
                    <Button onClick={onClose} className="flex-1" disabled={loading}>
                        Maybe Later
                    </Button>
                    <PrimaryButton onClick={handleUpgrade} className="flex-1 py-2" disabled={loading}>
                        <FaCrown className="mr-2" size={14} />
                        {loading ? 'Loading...' : 'Subscribe Now'}
                    </PrimaryButton>
                </div>

                <p className="text-center text-xs text-text-muted mt-4">
                    Secure payment processed by Stripe
                </p>
            </div>
        </div>
    );
}
