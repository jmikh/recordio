import { Modal, LogoLink } from '@shared/components';
import { SUPPORT_EMAIL } from '@shared/types/bridge';
import { SignInForm } from './SignInForm';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAuthSuccess?: () => void;
    /** Context copy overrides (e.g. the invite-accept flow) */
    eyebrow?: string;
    title?: string;
    subtitle?: string;
}

/**
 * Sign-in as an in-context prompt — the invite-accept flow and the shared
 * screenshot page, where signing in is one step in something else and the
 * page behind it still matters. Surfaces where signing in is the only thing
 * on offer use AuthPage instead.
 */
export function AuthModal({
    isOpen,
    onClose,
    onAuthSuccess,
    eyebrow = 'Welcome back',
    title = 'Sign in to keep recording',
    subtitle = 'Pick up where you left off — your projects are waiting.',
}: AuthModalProps) {
    const handleSignedIn = () => {
        onClose();
        // Let the auth state propagate before the caller acts on it
        setTimeout(() => { onAuthSuccess?.(); }, 500);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[460px]" ariaLabel="Sign in">
            <div className="flex flex-col items-center text-center py-6 px-4">
                <LogoLink imgClassName="h-8" className="mb-12" />

                <p className="text-eyebrow text-primary mb-3">
                    {eyebrow}
                </p>
                <h2 className="heading-1 mb-2">
                    {title}
                </h2>
                <p className="text-sm text-text-muted mb-10">
                    {subtitle}
                </p>

                <SignInForm onSignedIn={handleSignedIn} />

                <div className="mt-12 text-xs text-text-muted">
                    Need help?{' '}
                    <a href={`mailto:${SUPPORT_EMAIL}`} target="_blank" rel="noopener noreferrer" className="text-text-highlighted hover:underline">
                        Contact support
                    </a>
                </div>
            </div>
        </Modal>
    );
}
