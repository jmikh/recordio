/**
 * /admin, /admin/projects and /admin/growth — the hidden admin surface
 * (plans/admin-user-impersonation-oneshot.md).
 *
 * Gated up front: nothing renders but the bare page background until
 * admin-status answers. A 403 becomes a plain 404 — the route's
 * existence is never revealed, and no admin panel mounts or fetches
 * for a non-admin. Only a confirmed admin gets the sections:
 *
 *   /admin           Users    — impersonation picker (ImpersonatePanel)
 *   /admin/projects  Projects — recent projects, click to open as owner (RecentProjectsPanel)
 *   /admin/growth    Growth   — accounts/projects over time (GrowthPanel)
 */
import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { LuChartLine, LuUsers, LuVideo } from 'react-icons/lu';
import { Button, LogoLink, Modal, SidebarNav, SidebarNavItem } from '@shared/components';
import { invokeFunction } from '../../api/client';
import { navigate } from '../../lib/navigate';
import { ImpersonatePanel } from './ImpersonatePanel';
import { RecentProjectsPanel } from './RecentProjectsPanel';
import { GrowthPanel } from './GrowthPanel';
import { ADMIN_SECTION_PATHS, type AdminSection } from './adminSection';

type Gate = 'checking' | 'ready' | 'forbidden' | 'error';

const SECTIONS: Array<{ id: AdminSection; label: string; icon: typeof LuUsers }> = [
    { id: 'users', label: 'Users', icon: LuUsers },
    { id: 'projects', label: 'Projects', icon: LuVideo },
    { id: 'growth', label: 'Growth', icon: LuChartLine },
];

interface AdminPageProps {
    section: AdminSection;
}

export function AdminPage({ section }: AdminPageProps) {
    const [gate, setGate] = useState<Gate>('checking');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { error } = await invokeFunction('admin-status', {});
            if (cancelled) return;
            if (!error) {
                setGate('ready');
                return;
            }
            const forbidden = error instanceof FunctionsHttpError
                && (error.context as Response).status === 403;
            setGate(forbidden ? 'forbidden' : 'error');
        })();
        return () => {
            cancelled = true;
        };
    }, [attempt]);

    // Nothing but the page background until we know — no header, no
    // panel, no fetch. Same hold App uses while auth is resolving.
    if (gate === 'checking') {
        return (
            <div className="min-h-screen bg-surface-body">
                <span className="sr-only" role="status">Loading...</span>
            </div>
        );
    }

    // Non-admins get a plain 404 — never reveal that /admin exists
    if (gate === 'forbidden') {
        return (
            <div className="min-h-screen bg-surface-body">
                <Modal isOpen ariaLabel="Page not found" maxWidth="max-w-[440px]">
                    <h2 className="heading-1 mb-1">404</h2>
                    <p className="text-sm text-text-main mb-6">
                        This page doesn&apos;t exist.
                    </p>
                    <Button
                        variant="primary"
                        onClick={() => navigate('/')}
                        className="w-full"
                    >
                        Go to home page
                    </Button>
                </Modal>
            </div>
        );
    }

    // Couldn't reach the server (network, 5xx) — not a verdict either way
    if (gate === 'error') {
        return (
            <div className="min-h-screen bg-surface-body flex flex-col items-center justify-center gap-4 px-4">
                <p className="text-sm text-destructive" role="alert">Couldn&apos;t verify access.</p>
                <Button
                    variant="base"
                    onClick={() => {
                        setGate('checking');
                        setAttempt(a => a + 1);
                    }}
                >
                    Try again
                </Button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-surface-body flex">
            <aside className="w-56 shrink-0 py-8 flex flex-col gap-8">
                <div className="px-4">
                    <LogoLink imgClassName="h-8" />
                </div>
                <SidebarNav id="admin-nav">
                    {SECTIONS.map(s => (
                        <SidebarNavItem
                            key={s.id}
                            label={s.label}
                            icon={s.icon}
                            active={section === s.id}
                            onClick={() => navigate(ADMIN_SECTION_PATHS[s.id])}
                        />
                    ))}
                </SidebarNav>
            </aside>
            <main className="flex-1 min-w-0 px-8 py-10">
                <div className="w-full max-w-3xl">
                    {section === 'users' && <ImpersonatePanel />}
                    {section === 'projects' && <RecentProjectsPanel />}
                    {section === 'growth' && <GrowthPanel />}
                </div>
            </main>
        </div>
    );
}
