import { useState } from 'react';
import { FcGoogle } from 'react-icons/fc';
import { AuthManager } from './AuthManager';
import { Button } from '@shared/components';
import { MARKETING_ORIGIN } from '@shared/types/bridge';

interface SignInFormProps {
    /** Fires once a sign-in call has succeeded (OAuth redirect or dev login) */
    onSignedIn?: () => void;
}

/**
 * The sign-in controls themselves — Google, the DEV-only email form, and the
 * terms line. Shared by AuthModal (in-context prompts) and AuthPage (the
 * full-page gate) so the labels e2e drives and the auth calls live in one place.
 */
export function SignInForm({ onSignedIn }: SignInFormProps) {
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
            setLoading(false);
            onSignedIn?.();
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
            onSignedIn?.();
        }
    };

    return (
        <div className="w-full">
            {error && (
                <div role="alert" className="w-full bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-[var(--radius-md)] text-xs mb-4">
                    {error}
                </div>
            )}

            <Button
                variant="base"
                fullWidth
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="h-12 gap-3 bg-surface shadow-sm"
            >
                {loading ? (
                    <div className="h-5 w-5 border-2 border-border-hover border-t-text-highlighted rounded-full animate-spin" />
                ) : (
                    <FcGoogle className="icon-lg" />
                )}
                <span>{loading ? 'Connecting...' : 'Continue with Google'}</span>
            </Button>

            {import.meta.env.DEV && (
                <form onSubmit={handleDevSignIn} className="w-full mt-6 border border-border rounded-[var(--radius-md)] p-4 text-left">
                    <p className="text-eyebrow mb-3">Dev login</p>
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
                    <Button type="submit" variant="primary" fullWidth disabled={loading || !devEmail || !devPassword}>
                        {loading ? 'Signing in…' : 'Sign in / Create account'}
                    </Button>
                    <p className="text-label mt-2">Account is auto-created on first sign-in.</p>
                </form>
            )}

            <p className="text-xs text-text-muted mt-4">
                By continuing, you agree to our{' '}
                <a href={`${MARKETING_ORIGIN}/terms`} target="_blank" rel="noopener noreferrer" className="underline hover:text-text-highlighted">Terms</a>
                {' '}and{' '}
                <a href={`${MARKETING_ORIGIN}/privacy`} target="_blank" rel="noopener noreferrer" className="underline hover:text-text-highlighted">Privacy Policy</a>.
            </p>
        </div>
    );
}
