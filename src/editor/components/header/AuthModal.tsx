import { useState } from 'react';
import { FcGoogle } from 'react-icons/fc';
import { AuthManager } from '../../../auth/AuthManager';
import { XButton } from '../../../components/ui/XButton';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAuthSuccess?: () => void;
}

export function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

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
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm p-4">
            <div className="bg-surface-raised rounded-lg p-6 w-full max-w-[400px] border border-border">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-lg font-semibold text-text-highlighted">
                            Sign In to Recordio
                        </h2>
                        <p className="text-xs text-text-muted mt-1">
                            Unlock Pro features and remove watermarks
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
                        <div className="bg-red-900/20 border border-red-500/50 text-red-400 px-3 py-2 rounded-sm text-xs">
                            {error}
                        </div>
                    )}

                    {/* Google Sign In */}
                    <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        disabled={loading}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-gray-100 text-gray-900 font-medium rounded-sm border border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                        {loading ? (
                            <div className="h-4 w-4 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin"></div>
                        ) : (
                            <FcGoogle className="group-hover:scale-110 transition-transform" size={20} />
                        )}
                        <span>{loading ? 'Connecting...' : 'Continue with Google'}</span>
                    </button>

                    <p className="text-center text-[10px] text-text-muted px-4">
                        By continuing, you agree to our <a href="https://recordio.site/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-text-highlighted">Terms of Service</a> and <a href="https://recordio.site/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-text-highlighted">Privacy Policy</a>.
                    </p>
                </div>
            </div>
        </div>
    );
}
