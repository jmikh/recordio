import { create } from 'zustand';
import { Modal, Button } from '@shared/components';
import { CHROME_EXTENSION_URL } from '@shared/urls';
import { invokeFunction } from '../api/client';
import { LocalPreferences } from '../lib/localPreferences';
import {
    trackReviewModalViewed,
    trackReviewModalReviewClicked,
    trackReviewModalAlreadyReviewedClicked,
    trackReviewModalMaybeLaterClicked,
    type ReviewModalTrigger,
} from '../analytics';

const REVIEW_URL = `${CHROME_EXTENSION_URL}/reviews`;

/** Most times the review ask may ever be shown on one device. */
const MAX_REVIEW_PROMPTS = 3;

/**
 * Global open state: triggers live on transient surfaces (trial-extend
 * links, export flows), so the modal mounts once in App and opens via
 * this store. hasReviewed caches the profile flag for the session —
 * null until first checked.
 */
export const useLeaveReviewModal = create<{
    isOpen: boolean;
    trigger: ReviewModalTrigger;
    hasReviewed: boolean | null;
    setHasReviewed: (v: boolean) => void;
    open: (trigger: ReviewModalTrigger) => void;
    close: () => void;
}>((set) => ({
    isOpen: false,
    trigger: 'export_completed',
    hasReviewed: null,
    setHasReviewed: (v) => set({ hasReviewed: v }),
    open: (trigger) => set({ isOpen: true, trigger }),
    close: () => set({ isOpen: false }),
}));

/**
 * Opens the review ask unless it's been capped out. Frequency caps are
 * device-local (at most MAX_REVIEW_PROMPTS ever, at most once per day);
 * whether the user has already reviewed is the DB-backed source of truth,
 * checked once per session and cached. Local caps are checked first so a
 * capped device skips the profile round-trip entirely. Fire-and-forget:
 * failures just skip the ask.
 */
export async function maybeOpenLeaveReviewModal(trigger: ReviewModalTrigger): Promise<void> {
    if (LocalPreferences.getReviewShownCount() >= MAX_REVIEW_PROMPTS) return;
    if (LocalPreferences.hasShownReviewToday()) return;

    const store = useLeaveReviewModal.getState();
    let reviewed = store.hasReviewed;
    if (reviewed === null) {
        const { data } = await invokeFunction('user-profile-get', {});
        reviewed = data?.has_reviewed ?? false;
        useLeaveReviewModal.getState().setHasReviewed(reviewed);
    }
    if (reviewed) return;

    LocalPreferences.recordReviewShown();
    trackReviewModalViewed(trigger);
    useLeaveReviewModal.getState().open(trigger);
}

/** Persist the claim; the modal never shows again for this user. */
function markReviewed() {
    useLeaveReviewModal.getState().setHasReviewed(true);
    void invokeFunction('user-review-set', {});
}

/**
 * The one review ask (replaces the Step 3 TrialExtendedModal and the
 * old post-export ReviewModal). Personal, short, never conditional on
 * anything (CWS policy forbids incentivized reviews). "Maybe later"
 * stores nothing — the ask may reappear on a later trigger.
 */
export function LeaveReviewModal() {
    const { isOpen, trigger, close } = useLeaveReviewModal();

    const handleReview = () => {
        trackReviewModalReviewClicked(trigger);
        markReviewed();
        window.open(REVIEW_URL, '_blank', 'noopener');
        close();
    };

    const handleAlreadyReviewed = () => {
        trackReviewModalAlreadyReviewedClicked(trigger);
        markReviewed();
        close();
    };

    const handleMaybeLater = () => {
        trackReviewModalMaybeLaterClicked(trigger);
        close();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleMaybeLater} maxWidth="max-w-[380px]" ariaLabel="Leave a review">
            <div className="flex justify-center mb-3">
                <img
                    src="/assets/images/john.webp"
                    alt="John, Recordio's founder"
                    className="w-16 h-16 rounded-full object-cover border-2 border-border"
                />
            </div>

            <h2 className="heading-2 text-center mb-2">
                Hi, I'm John 👋
            </h2>
            <p className="text-sm text-text-muted text-center mb-6 leading-relaxed">
                I am the founder of Recordio. If you're enjoying it, please spare 10 seconds to leave a review. It really makes a difference. 
            </p>

            <Button
                variant="primary"
                onClick={handleReview}
                fullWidth
                className="py-3 text-base font-bold rounded-lg"
            >
                ⭐ Leave a review
            </Button>
            <Button variant="ghost" onClick={handleAlreadyReviewed} fullWidth className="mt-2">
                I already left a review
            </Button>
            <Button variant="ghost" onClick={handleMaybeLater} fullWidth className="mt-1 text-text-muted">
                Maybe later
            </Button>
        </Modal>
    );
}
