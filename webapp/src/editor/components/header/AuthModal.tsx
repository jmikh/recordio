import { useState } from 'react';
import { FcGoogle } from 'react-icons/fc';
import { AuthManager } from '../../../auth/AuthManager';
import { XButton, Modal } from '@shared/components';
import { MARKETING_ORIGIN } from '@shared/types/bridge';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAuthSuccess?: () => void;
}

export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGoogleSignIn = async () => {
        setLoading(true);
        setError(null);

        const result = await AuthManager.signInWithProvider('google');

        if (result.error) {
            setError(result.error.message);
            setLoading(false);
        } else {
            // OAuth successful, close modal
            setLoading(false);
            onClose();

            // Wait a moment for auth state to propagate
            setTimeout(() => {
                onAuthSuccess?.();
            }, 500);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[400px]">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-lg font-semibold text-text-highlighted">
                        Sign In to Recordio
                    </h2>
                    <p className="text-xs text-text-muted mt-1">
                        Unlock Pro features
                    </p>
                </div>
                <XButton
                    onClick={onClose}
                    title="Close"
                />
            </div>

            <div className="space-y-4">
                {/* Error Message */}
                {error && (
                    <div className="bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-sm text-xs">
                        {error}
                    </div>
                )}

                {/* Google Sign In */}
                <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-surface-raised hover:bg-state-hover text-text-highlighted font-medium rounded-[var(--radius-interactive)] border border-border transition-colors disabled:opacity-50 group"
                >
                    {loading ? (
                        <div className="h-4 w-4 border-2 border-border-hover border-t-text-highlighted rounded-full animate-spin"></div>
                    ) : (
                        <FcGoogle className="icon-lg group-hover:scale-110 transition-transform" />
                    )}
                    <span>{loading ? 'Connecting...' : 'Continue with Google'}</span>
                </button>

                <p className="text-center text-[10px] text-text-muted px-4">
                    By continuing, you agree to our <a href={`${MARKETING_ORIGIN}/terms`} target="_blank" rel="noopener noreferrer" className="underline hover:text-text-highlighted">Terms of Service</a> and <a href={`${MARKETING_ORIGIN}/privacy`} target="_blank" rel="noopener noreferrer" className="underline hover:text-text-highlighted">Privacy Policy</a>.
                </p>
            </div>
        </Modal>
    );
}
