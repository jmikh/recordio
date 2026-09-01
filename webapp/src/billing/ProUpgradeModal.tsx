import { useEffect } from 'react';
import { Modal, Button, LogoLink, XButton } from '@shared/components';
import { LuCheck } from 'react-icons/lu';
import { SUPPORT_EMAIL } from '@shared/urls';
import { useEntitlements } from './useEntitlements';
import { TrialExtendLink } from './TrialExtendLink';
import {
    trackUpgradeModalViewed,
    trackUpgradeModalDismissed,
    trackUpgradeModalUpgradeClicked,
    type UpgradeModalReason,
} from '../analytics';

const PRO_FEATURES = [
    'Unlimited transcriptions',
    '4K exports',
    'Background exports',
    'Team collaboration',
];

interface ProUpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Feature name woven into the title, e.g. "publishing" — omit for the generic title. */
    feature?: string;
    /** Stable mixpanel bucket for the upgrade funnel (viewed / dismissed / clicked). */
    reason: UpgradeModalReason;
}

/**
 * Unified locked-feature modal (AuthModal's layout: centered logo,
 * eyebrow + title, support footer). The title names the feature that
 * triggered it; the trial-extension link appears only while
 * entitlements.canExtendTrial (revamp Step 3).
 */
export function ProUpgradeModal({ isOpen, onClose, feature, reason }: ProUpgradeModalProps) {
    const { canExtendTrial } = useEntitlements();

    useEffect(() => {
        if (isOpen) trackUpgradeModalViewed(reason);
    }, [isOpen, reason]);

    // Dismissal only — the upgrade path closes via handleUpgrade and the
    // trial extension via onExtended (tracked by their own events)
    const handleDismiss = () => {
        trackUpgradeModalDismissed(reason);
        onClose();
    };

    // New tab (Step 4): the caller's context must survive — especially the
    // import page, where in-tab navigation would lose the recording.
    const handleUpgrade = () => {
        trackUpgradeModalUpgradeClicked(reason);
        onClose();
        window.open('/workspace/settings/billing', '_blank');
    };

    return (
        <Modal isOpen={isOpen} onClose={handleDismiss} maxWidth="max-w-[460px]" ariaLabel="Upgrade to Pro">
            <div className="relative flex flex-col items-center text-center py-6 px-4">
                <div className="absolute -top-2 -right-2">
                    <XButton onClick={handleDismiss} title="Close" />
                </div>
                <LogoLink imgClassName="h-8" className="mb-10" />

                <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">
                    Trial ended
                </p>
                <h2 className="text-2xl font-bold text-text-highlighted mb-2">
                    {feature ? `Upgrade to unlock ${feature}` : 'Upgrade to unlock Pro'}
                </h2>
                <p className="text-sm text-text-muted mb-8">
                    Your recordings are safe and stay editable — upgrading
                    unlocks everything below.
                </p>

                <Button
                    variant="primary"
                    onClick={handleUpgrade}
                    fullWidth
                    className="py-3 text-base font-semibold rounded-lg"
                >
                    Upgrade now
                </Button>
                <p className="text-xs text-text-muted mt-3">
                    Plans start at $12/month. Cancel anytime.
                </p>

                <div className="w-full border border-border rounded-lg p-4 mt-6 text-left">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                        Pro includes
                    </p>
                    <ul className="flex flex-col gap-2">
                        {PRO_FEATURES.map((item) => (
                            <li key={item} className="flex items-center gap-2.5 text-sm text-text-main">
                                <LuCheck className="icon-sm text-primary shrink-0" />
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>

                {canExtendTrial && (
                    <p className="flex items-center justify-center gap-1 text-xs text-text-muted mt-4">
                        Not ready yet?
                        <TrialExtendLink
                            label="Request a trial extension"
                            className="underline"
                            onExtended={onClose}
                        />
                    </p>
                )}

                <div className="mt-8 text-xs text-text-muted">
                    Need help?{' '}
                    <a
                        href={`mailto:${SUPPORT_EMAIL}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-highlighted font-medium hover:underline"
                    >
                        Contact support
                    </a>
                </div>
            </div>
        </Modal>
    );
}
