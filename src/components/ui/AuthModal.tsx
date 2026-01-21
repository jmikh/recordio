import { useState } from 'react';
import { FaUser, FaLock, FaGoogle } from 'react-icons/fa';
import { AuthManager } from '../../auth/AuthManager';
import { PrimaryButton } from './PrimaryButton';
import { XButton } from './XButton';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAuthSuccess?: () => void;
}

export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
    const [mode, setMode] = useState<'signin' | 'signup'>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim() || !password.trim()) return;

        setLoading(true);
        setError(null);

        const { error: authError } = mode === 'signin'
            ? await AuthManager.signIn(email, password)
            : await AuthManager.signUp(email, password);

        if (authError) {
            setError(authError.message);
            setLoading(false);
        } else {
            // Success! Auth listener will update useUserStore
            setLoading(false);
            setEmail('');
            setPassword('');
            onClose();

            // Wait a moment for auth state to propagate
            setTimeout(() => {
                onAuthSuccess?.();
            }, 500);
        }
    };

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

    const handleModeSwitch = () => {
        setMode(mode === 'signin' ? 'signup' : 'signin');
        setError(null);
    };

    return (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
            <div className="bg-surface-raised rounded-lg p-6 w-full max-w-[400px] border border-border">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-lg font-semibold text-text-highlighted">
                            {mode === 'signin' ? 'Sign In to Recordio' : 'Create Account'}
                        </h2>
                        {mode === 'signup' && (
                            <p className="text-xs text-text-muted mt-1">
                                Unlock Pro features and remove watermarks
                            </p>
                        )}
                    </div>
                    <XButton
                        onClick={onClose}
                        title="Close"
                    />
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="space-y-4">
                        {/* Email Input */}
                        <div>
                            <label htmlFor="email" className="block text-xs font-medium text-text-highlighted mb-2">
                                Email
                            </label>
                            <div className="relative">
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-main">
                                    <FaUser size={12} />
                                </div>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="your@email.com"
                                    className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-sm text-text-highlighted placeholder:text-text-main text-sm focus:outline-none focus:border-border-highlighted transition-colors"
                                    required
                                    autoComplete="email"
                                    autoFocus
                                />
                            </div>
                        </div>

                        {/* Password Input */}
                        <div>
                            <label htmlFor="password" className="block text-xs font-medium text-text-highlighted mb-2">
                                Password
                            </label>
                            <div className="relative">
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-main">
                                    <FaLock size={12} />
                                </div>
                                <input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={mode === 'signup' ? 'Min. 6 characters' : 'Your password'}
                                    className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-sm text-text-highlighted placeholder:text-text-main text-sm focus:outline-none focus:border-border-highlighted transition-colors"
                                    required
                                    minLength={6}
                                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                                />
                            </div>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="bg-red-900/20 border border-red-500/50 text-red-400 px-3 py-2 rounded-sm text-xs">
                                {error}
                            </div>
                        )}

                        {/* Submit Button */}
                        <PrimaryButton
                            type="submit"
                            disabled={loading || !email.trim() || !password.trim()}
                            className="w-full py-2"
                        >
                            {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
                        </PrimaryButton>

                        {/* Divider */}
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-border"></div>
                            </div>
                            <div className="relative flex justify-center text-xs">
                                <span className="bg-surface-raised px-2 text-text-muted">Or continue with</span>
                            </div>
                        </div>

                        {/* Google Sign In */}
                        <button
                            type="button"
                            onClick={handleGoogleSignIn}
                            disabled={loading}
                            className="w-full flex items-center justify-center gap-3 px-4 py-2 bg-white hover:bg-gray-100 text-gray-900 font-medium rounded-sm border border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <FaGoogle className="text-[#4285F4]" size={16} />
                            <span>Sign in with Google</span>
                        </button>

                        {/* Mode Switch */}
                        <button
                            type="button"
                            onClick={handleModeSwitch}
                            className="w-full text-xs text-text-main hover:text-text-highlighted transition-colors"
                        >
                            {mode === 'signin'
                                ? "Don't have an account? Sign up"
                                : 'Already have an account? Sign in'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
