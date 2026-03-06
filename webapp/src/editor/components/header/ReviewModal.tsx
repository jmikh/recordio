import { Modal } from '@shared/components';
import { trackReviewToast } from '../../../core/analytics';

const REVIEW_TOAST_KEY = 'recordio-review-toast-shown';
const REVIEW_URL = 'https://chromewebstore.google.com/detail/recordio-smart-screen-rec/bbcdpipjplklaneplfmlhhibnllhinii/reviews';

interface ReviewModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ReviewModal({ isOpen, onClose }: ReviewModalProps) {
    const handleReview = () => {
        trackReviewToast('clicked');
        window.open(REVIEW_URL, '_blank', 'noopener');
        onClose();
    };

    const handleDismiss = () => {
        trackReviewToast('dismissed');
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleDismiss} maxWidth="max-w-[360px]">
            {/* Avatar */}
            <div className="flex justify-center mb-3">
                <img
                    src="/assets/images/john.webp"
                    alt="John"
                    className="w-16 h-16 rounded-full object-cover border-2 border-border"
                />
            </div>

            {/* Greeting */}
            <h2 className="text-xl font-bold text-text-highlighted text-center mb-2">
                Hi, I'm John 👋
            </h2>

            {/* Body */}
            <p className="text-sm text-text-muted text-center mb-6 leading-relaxed">
                I'm a solo developer building Recordio. If you're enjoying it,
                a quick review on the Chrome Web Store would go a long way.
            </p>

            {/* CTA */}
            <button
                onClick={handleReview}
                className="interactive-primary flex items-center justify-center gap-2 w-full py-3 text-base font-semibold rounded-lg"
            >
                ⭐ Leave a Review
            </button>

            {/* Dismiss */}
            <button
                onClick={handleDismiss}
                className="w-full py-2.5 mt-2 text-sm text-text-muted hover:text-text-main transition-colors rounded-lg"
            >
                Maybe Later
            </button>
        </Modal>
    );
}

/**
 * Check whether the review modal should be shown.
 * Returns true at most once per user (localStorage guard).
 * In dev mode, always returns true for testing.
 */
export function shouldShowReviewModal(): boolean {
    // ⚠️ DEV ONLY — remove `!import.meta.env.DEV &&` after testing:
    if (localStorage.getItem(REVIEW_TOAST_KEY) === 'true') return false;
    localStorage.setItem(REVIEW_TOAST_KEY, 'true');
    trackReviewToast('shown');
    return true;
}
