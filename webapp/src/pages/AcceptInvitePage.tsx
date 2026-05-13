import { useState, useEffect } from 'react';
import { LuLoader, LuCircleCheck, LuCircleX } from 'react-icons/lu';
import { Button, LogoLink } from '@shared/components';
import { supabase } from '../auth/AuthManager';
import { useUserStore } from '../editor/stores/useUserStore';
import { AuthModal } from '../editor/components/header/AuthModal';

type Status = 'waiting-auth' | 'accepting' | 'success' | 'error';

export function AcceptInvitePage() {
    const token = new URLSearchParams(window.location.search).get('token');
    const isAuthenticated = useUserStore(s => s.isAuthenticated);

    const [status, setStatus] = useState<Status>('waiting-auth');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [showAuthModal, setShowAuthModal] = useState(false);

    const accept = async () => {
        if (!token || !supabase) {
            setErrorMsg('Invalid invitation link.');
            setStatus('error');
            return;
        }

        setStatus('accepting');
        try {
            const { error } = await supabase.rpc('workspace_invite_accept', { p_token: token });
            if (error) throw error;
            setStatus('success');
            // Full reload so AuthManager re-loads the now-default workspace
            setTimeout(() => { window.location.href = '/'; }, 1800);
        } catch (err: any) {
            setErrorMsg(err?.message ?? 'Failed to accept invitation.');
            setStatus('error');
        }
    };

    // Once auth is confirmed, kick off the accept call
    useEffect(() => {
        if (isAuthenticated && status === 'waiting-auth') {
            accept();
        }
    }, [isAuthenticated, status]);

    // If not authenticated after a short wait, prompt sign-in
    useEffect(() => {
        if (!isAuthenticated) {
            setShowAuthModal(true);
        }
    }, []);

    if (!token) {
        return (
            <PageShell>
                <LuCircleX className="text-destructive mb-4" size={40} />
                <h1 className="text-xl font-bold text-text-highlighted mb-2">Invalid link</h1>
                <p className="text-sm text-text-muted mb-6">This invitation link is missing a token.</p>
                <Button variant="primary" onClick={() => { window.location.href = '/'; }}>Go to Dashboard</Button>
            </PageShell>
        );
    }

    return (
        <>
            <PageShell>
                {status === 'waiting-auth' && (
                    <>
                        <LuLoader className="text-primary mb-4 animate-spin" size={36} />
                        <p className="text-sm text-text-muted">Waiting for sign-in…</p>
                    </>
                )}

                {status === 'accepting' && (
                    <>
                        <LuLoader className="text-primary mb-4 animate-spin" size={36} />
                        <p className="text-sm text-text-muted">Accepting invitation…</p>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <LuCircleCheck className="text-success mb-4" size={40} />
                        <h1 className="text-xl font-bold text-text-highlighted mb-2">You're in!</h1>
                        <p className="text-sm text-text-muted">Taking you to your workspace…</p>
                    </>
                )}

                {status === 'error' && (
                    <>
                        <LuCircleX className="text-destructive mb-4" size={40} />
                        <h1 className="text-xl font-bold text-text-highlighted mb-2">Invitation failed</h1>
                        <p className="text-sm text-text-muted mb-6">{errorMsg}</p>
                        <Button variant="primary" onClick={() => { window.location.href = '/'; }}>Go to Dashboard</Button>
                    </>
                )}
            </PageShell>

            <AuthModal
                isOpen={showAuthModal && !isAuthenticated}
                onClose={() => setShowAuthModal(false)}
                onAuthSuccess={() => {
                    setShowAuthModal(false);
                    accept();
                }}
            />
        </>
    );
}

function PageShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-surface-body flex flex-col items-center justify-center px-4">
            <div className="mb-10">
                <LogoLink imgClassName="h-8" />
            </div>
            <div className="flex flex-col items-center text-center">
                {children}
            </div>
        </div>
    );
}
