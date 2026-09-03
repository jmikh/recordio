import { useState, useEffect, useRef } from 'react';
import { LuLoader } from 'react-icons/lu';
import { invokeFunction } from '../../api/client';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useUserStore } from '../../auth/useUserStore';
import { useToast } from '../../components/Toast';
import { captureError } from '../../lib/sentry';
import { trackWorkspaceSettingsPageLoaded } from '../../analytics';
import { GeneralSection } from './GeneralSection';
import { MembersSection } from './MembersSection';
import { BillingSection } from './BillingSection';
import type { WorkspaceDetails } from './types';

type SectionId = 'members' | 'billing';

// Legacy tab URLs (/workspace/settings/members|billing) and #hash links target
// a section of the unified page.
function readScrollTarget(): SectionId | null {
    const seg = window.location.hash.replace('#', '') || window.location.pathname.split('/').pop();
    return seg === 'members' || seg === 'billing' ? seg : null;
}

/**
 * All workspace settings on a single page — rendered inside the dashboard
 * layout next to the main sidebar (no layout of its own).
 */
export function WorkspaceSettingsPage() {
    const {
        workspaceId, workspaceName, workspaceRole, setWorkspace,
        workspaceOwnerId, workspaceSeats, hasActivePlan,
    } = useWorkspaceStore();
    const { userId } = useUserStore();
    const { addToast } = useToast();

    // Single plan since the billing revamp: any active subscription includes collaboration
    const hasTeamAccess = hasActivePlan;

    const [details, setDetails] = useState<WorkspaceDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const scrollTarget = useRef(readScrollTarget());

    const isAdmin = workspaceRole === 'admin';

    useEffect(() => { trackWorkspaceSettingsPageLoaded(workspaceId); }, []);

    useEffect(() => {
        if (!workspaceId) return;
        setLoading(true);
        (async () => {
            try {
                const { data, error } = await invokeFunction('workspace-get', { workspaceId });
                if (!error && data) setDetails(data);
                else addToast({ type: 'error', title: 'Failed to load workspace' });
            } catch (err) {
                captureError(err, { flow: 'workspace', phase: 'load', workspaceId: workspaceId ?? undefined });
                addToast({ type: 'error', title: 'Failed to load workspace' });
            } finally {
                setLoading(false);
            }
        })();
    }, [workspaceId]);

    // Honor a deep-linked section once the sections have rendered
    useEffect(() => {
        if (loading || !scrollTarget.current) return;
        const target = scrollTarget.current;
        scrollTarget.current = null;
        document.getElementById(`settings-${target}`)?.scrollIntoView({ block: 'start' });
    }, [loading]);

    const scrollTo = (section: SectionId) =>
        document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Anchor navigations while already mounted (e.g. sidebar "Plan and billing")
    useEffect(() => {
        const onNavigate = () => {
            const target = readScrollTarget();
            if (target) scrollTo(target);
        };
        window.addEventListener('navigate', onNavigate);
        window.addEventListener('popstate', onNavigate);
        return () => {
            window.removeEventListener('navigate', onNavigate);
            window.removeEventListener('popstate', onNavigate);
        };
    }, []);

    const handleRenamed = (name: string) => {
        if (!workspaceId || !workspaceOwnerId) return;
        setWorkspace(workspaceId, name, workspaceOwnerId, workspaceRole, workspaceSeats);
        setDetails(prev => prev ? { ...prev, name } : prev);
    };

    const handleMemberRemoved = (removedUserId: string) => {
        setDetails(prev => prev
            ? { ...prev, members: prev.members.filter(m => m.user_id !== removedUserId) }
            : prev
        );
    };

    const handleMemberRoleChanged = (userId: string, role: 'viewer' | 'creator' | 'admin') => {
        setDetails(prev => prev
            ? { ...prev, members: prev.members.map(m => m.user_id === userId ? { ...m, role } : m) }
            : prev
        );
    };

    const handleInvitationRescinded = (invitationId: string) => {
        setDetails(prev => prev
            ? { ...prev, invitations: prev.invitations.filter(i => i.id !== invitationId) }
            : prev
        );
    };

    return (
        <div className="w-full max-w-2xl mx-auto flex flex-col gap-10 pb-16">
            {/* Page header */}
            <div>
                <h1 className="heading-2">Workspace settings</h1>
                <p className="text-sm text-text-muted mt-1">
                    Name, members, and plan for {workspaceName ?? 'your workspace'}.
                </p>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-text-muted text-sm">
                    <LuLoader className="icon-sm animate-spin" /> Loading…
                </div>
            ) : !details ? (
                <p className="text-sm text-text-muted">Could not load workspace settings.</p>
            ) : (
                <>
                    <section>
                        <GeneralSection details={details} isAdmin={isAdmin} onRenamed={handleRenamed} />
                    </section>

                    <section id="settings-members" className="border-t border-border pt-10">
                        <MembersSection
                            details={details}
                            currentUserId={userId}
                            hasTeamAccess={hasTeamAccess}
                            onMemberRemoved={handleMemberRemoved}
                            onMemberRoleChanged={handleMemberRoleChanged}
                            onInvitationRescinded={handleInvitationRescinded}
                            onGoToBilling={() => scrollTo('billing')}
                        />
                    </section>
                </>
            )}

            <section id="settings-billing" className="border-t border-border pt-10">
                <BillingSection onGoToMembers={() => scrollTo('members')} />
            </section>
        </div>
    );
}
