import { create } from 'zustand';
import { Modal, Button } from '@shared/components';
import { CHROME_EXTENSION_URL } from '@shared/urls';
import { trackTrialReviewModalReviewClicked, trackTrialReviewModalDismissed } from '../analytics';

const REVIEW_URL = `${CHROME_EXTENSION_URL}/reviews`;

/**
 * Global open state: the extend link lives on transient surfaces
 * (hover tooltips, modals that close on success), so the success modal
 * must outlive its trigger — it mounts once in App and opens via this
 * store.
 */
export const useTrialExtendedModal = create<{
    isOpen: boolean;
    open: () => void;
    close: () => void;
}>((set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));

/**
 * Shown after a successful trial extension (billing revamp Step 3).
 * The grant is already complete before this renders — the review ask
 * is unconditional (CWS policy forbids incentivized reviews).
 */
export function TrialExtendedModal() {
    const { isOpen, close } = useTrialExtendedModal();

    const handleReview = () => {
        trackTrialReviewModalReviewClicked();
        window.open(REVIEW_URL, '_blank', 'noopener');
        close();
    };

    const handleDismiss = () => {
        trackTrialReviewModalDismissed();
        close();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleDismiss} maxWidth="max-w-[360px]" ariaLabel="Trial extended">
            <h2 className="text-xl font-bold text-text-highlighted text-center mb-2">
                Your trial has been extended 🎉
            </h2>
            <p className="text-sm text-text-muted text-center mb-6 leading-relaxed">
                You've got Pro features for another week. If you're enjoying
                Recordio, it would mean a lot if you left a quick Chrome Web
                Store review — it only takes a few seconds.
            </p>
            <Button
                variant="primary"
                onClick={handleReview}
                fullWidth
                className="py-3 text-base font-semibold rounded-lg"
            >
                ⭐ Leave a review
            </Button>
            <Button variant="ghost" onClick={handleDismiss} fullWidth className="mt-2">
                Maybe later
            </Button>
        </Modal>
    );
}
