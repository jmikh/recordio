import { Modal, Button, LogoLink } from '@shared/components';
import { navigate } from '../lib/navigate';
import { TrialExtendLink } from './TrialExtendLink';

interface ProUpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    feature?: string;
}

/**
 * Modal shown when a free user clicks a Pro-gated feature.
 * "Upgrade" navigates to billing; "Maybe Later" closes the modal.
 */
export function ProUpgradeModal({ isOpen, onClose, feature }: ProUpgradeModalProps) {
    const handleUpgrade = () => {
        onClose();
        navigate('/workspace/settings/billing');
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[360px]">
            <div className="flex flex-col gap-4">
                <LogoLink imgClassName="h-7" />
                <div className="flex flex-col gap-1.5">
                    <h2 className="text-text-highlighted font-semibold text-base">Pro Feature</h2>
                    <p className="text-text-muted text-sm">
                        {feature
                            ? `${feature} is available on the Pro plan.`
                            : 'This feature is available on the Pro plan.'}
                        {' '}Upgrade to unlock it.
                    </p>
                </div>
                <div className="flex gap-2 justify-end">
                    <Button variant="ghost" onClick={onClose}>
                        Maybe Later
                    </Button>
                    <Button variant="primary" onClick={handleUpgrade}>
                        Upgrade
                    </Button>
                </div>
                <TrialExtendLink
                    label="or extend your free trial — 7 more days"
                    className="self-center"
                    onExtended={onClose}
                />
            </div>
        </Modal>
    );
}
