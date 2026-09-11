import { LuCloudOff } from 'react-icons/lu';
import { Modal, LogoLink, Button } from '@shared/components';
import { SUPPORT_EMAIL } from '@shared/types/bridge';

/**
 * Shown instead of the sign-in modal when the stored session can't be
 * renewed because the auth server is unreachable — a different problem
 * from being signed out, and one signing in again wouldn't fix.
 *
 * No onClose: like the sign-in gate there's nothing behind it to go back to.
 */
export function AuthUnreachableModal() {
    return (
        <Modal isOpen maxWidth="max-w-[460px]" ariaLabel="Connection problem">
            <div className="flex flex-col items-center text-center py-6 px-4">
                <LogoLink imgClassName="h-8" className="mb-12" />

                <LuCloudOff size={32} className="text-text-muted mb-6" />

                <h2 className="heading-1 mb-2">Can't reach Recordio</h2>
                <p className="text-sm text-text-muted mb-10">
                    Check your internet connection and try again.
                </p>

                <Button variant="primary" onClick={() => window.location.reload()} className="w-full">
                    Try again
                </Button>

                <div className="mt-12 text-xs text-text-muted">
                    Still stuck?{' '}
                    <a
                        href={`mailto:${SUPPORT_EMAIL}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-highlighted hover:underline"
                    >
                        Contact support
                    </a>
                </div>
            </div>
        </Modal>
    );
}
