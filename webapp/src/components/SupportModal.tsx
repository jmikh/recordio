import { Modal, XButton } from '@shared/components';
import { MdOutlineBugReport } from 'react-icons/md';

interface SupportModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SupportModal({ isOpen, onClose }: SupportModalProps) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-md">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <MdOutlineBugReport className="icon-lg text-text-highlighted" />
                        <h2 className="text-lg font-semibold text-text-highlighted">Report a Bug</h2>
                    </div>
                    <XButton onClick={onClose} />
                </div>

                <p className="text-sm text-text-main leading-relaxed">
                    Have a question, a feature request, or found a bug?
                    <br />
                    We'd love to hear from you.
                </p>

                <p className="text-sm text-text-main">
                    Reach out to us at{' '}
                    <a
                        href="mailto:support@recordio.cc"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-medium"
                    >
                        support@recordio.cc
                    </a>
                </p>
            </div>
        </Modal>
    );
}
