import { useState } from 'react';
import { FcGoogle } from 'react-icons/fc';
import { AuthManager } from './AuthManager';
import { Modal, LogoLink, Button } from '@shared/components';
import { MARKETING_ORIGIN, SUPPORT_EMAIL } from '@shared/types/bridge';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAuthSuccess?: () => void;
}

export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [devEmail, setDevEmail] = useState('');
    const [devPassword, setDevPassword] = useState('');

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

    const handleDevSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!devEmail || !devPassword) return;
        setLoading(true);
        setError(null);

        const { error } = await AuthManager.signInWithEmail(devEmail, devPassword);
        if (error) {
            setError(error.message);
            setLoading(false);
        } else {
            setLoading(false);
            onClose();
            setTimeout(() => { onAuthSuccess?.(); }, 500);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[460px]" ariaLabel="Sign in">
            <div className="flex flex-col items-center text-center py-6 px-4">
                <LogoLink imgClassName="h-8" className="mb-12" />

                <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">
                    Welcome back
                </p>
                <h2 className="text-2xl font-bold text-text-highlighted mb-2">
                    Sign in to keep recording
                </h2>
                <p className="text-sm text-text-muted mb-10">
                    Pick up where you left off — your projects are waiting.
                </p>

                {error && (
                    <div className="w-full bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-md text-xs mb-4">
                        {error}
                    </div>
                )}

                <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3.5 bg-surface hover:bg-state-hover text-text-highlighted font-medium rounded-lg border border-border shadow-sm transition-colors disabled:opacity-50 group"
                >
                    {loading ? (
                        <div className="h-5 w-5 border-2 border-border-hover border-t-text-highlighted rounded-full animate-spin"></div>
                    ) : (
                        <FcGoogle size={20} className="group-hover:scale-110 transition-transform" />
                    )}
                    <span>{loading ? 'Connecting...' : 'Continue with Google'}</span>
                </button>

                {import.meta.env.DEV && (
                    <form onSubmit={handleDevSignIn} className="w-full mt-6 border border-border rounded-md p-4 text-left">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">Dev login</p>
                        <div className="flex flex-col gap-2 mb-3">
                            <input
                                type="email"
                                aria-label="Email"
                                placeholder="email@example.com"
                                value={devEmail}
                                onChange={e => setDevEmail(e.target.value)}
                                className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-(--radius-interactive) text-text-main placeholder:text-text-muted focus:outline-none focus:border-border-selected"
                            />
                            <input
                                type="password"
                                aria-label="Password"
                                placeholder="password"
                                value={devPassword}
                                onChange={e => setDevPassword(e.target.value)}
                                className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-(--radius-interactive) text-text-main placeholder:text-text-muted focus:outline-none focus:border-border-selected"
                            />
                        </div>
                        <Button type="submit" variant="primary" disabled={loading || !devEmail || !devPassword} className="w-full">
                            {loading ? 'Signing in…' : 'Sign in / Create account'}
                        </Button>
                        <p className="text-[10px] text-text-muted mt-2">Account is auto-created on first sign-in.</p>
                    </form>
                )}

                <p className="text-[11px] text-text-muted mt-6 px-4">
                    By continuing, you agree to our{' '}
                    <a href={`${MARKETING_ORIGIN}/terms`} target="_blank" rel="noopener noreferrer" className="underline hover:text-text-highlighted">Terms</a>
                    {' '}and{' '}
                    <a href={`${MARKETING_ORIGIN}/privacy`} target="_blank" rel="noopener noreferrer" className="underline hover:text-text-highlighted">Privacy Policy</a>.
                </p>

                <div className="mt-12 text-xs text-text-muted">
                    Need help?{' '}
                    <a href={`mailto:${SUPPORT_EMAIL}`} target="_blank" rel="noopener noreferrer" className="text-text-highlighted font-medium hover:underline">
                        Contact support
                    </a>
                </div>
            </div>
        </Modal>
    );
}
