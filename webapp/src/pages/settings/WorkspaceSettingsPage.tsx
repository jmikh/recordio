import { useState, useEffect, useRef } from 'react';
import { LuLoader, LuLock } from 'react-icons/lu';
import { invokeFunction } from '../../api/client';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useUserStore } from '../../auth/useUserStore';
import { useToast } from '../../components/Toast';
import { captureError } from '../../lib/sentry';
import { trackWorkspaceSettingsPageLoaded } from '../../analytics';
import { GeneralSection } from './GeneralSection';
import { MembersSection } from './MembersSection';
import { BillingSection } from './BillingSection';
import type { WorkspaceDetails, WorkspaceInvitation } from './types';

type SectionId = 'members' | 'billing';

// Every section sits in its own bordered surface card on the tinted page ground
const SECTION_CARD = 'bg-surface border border-border rounded-[var(--radius-lg)] p-6';

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

    // The owner is synthesized as 'admin' server-side (workspace-get /
    // -get-default / -list), so admin covers owner. `details.role` is the
    // authoritative copy; the store's role is what we have before it loads.
    const role = details?.role ?? workspaceRole;
    const isAdmin = role === 'admin';
    // Role known and not admin — nothing on this page is theirs to see
    const accessDenied = role !== null && !isAdmin;

    useEffect(() => { trackWorkspaceSettingsPageLoaded(workspaceId); }, []);

    useEffect(() => {
        if (!workspaceId) return;
        // Viewers and creators get the no-access state — don't fetch details for them
        if (workspaceRole !== null && workspaceRole !== 'admin') { setLoading(false); return; }
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
    }, [workspaceId, workspaceRole]);

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

    // A sent/resent invitation replaces any prior one for that email (the
    // server deletes + reinserts the row) — the seat card counts it as
    // reserved immediately.
    const handleInvitationSent = (invitation: WorkspaceInvitation) => {
        setDetails(prev => prev
            ? { ...prev, invitations: [...prev.invitations.filter(i => i.email !== invitation.email), invitation] }
            : prev
        );
    };

    // Purchased seats changed on the billing card (or checkout completed)
    const handleSeatsChanged = (seats: number) => {
        setDetails(prev => prev ? { ...prev, seats } : prev);
    };

    // Seat pre-purchase (plans/seat-prepurchase-oneshot.md): the owner is
    // synthesized into members as admin, so creator/admin members = seats
    // in use; pending creator/admin invitations reserve seats.
    const usedSeats = Math.max(1, details?.members.filter(m => m.role === 'creator' || m.role === 'admin').length ?? 1);
    const reservedSeats = details?.invitations.filter(i => i.role !== 'viewer').length ?? 0;
    const viewerCount = details?.members.filter(m => m.role === 'viewer').length ?? 0;

    if (accessDenied) {
        return (
            <div className="w-full max-w-2xl mx-auto flex flex-col gap-6 pb-16">
                <div>
                    <h1 className="heading-2">Workspace settings</h1>
                </div>
                <div role="status" className={`${SECTION_CARD} flex items-start gap-3`}>
                    <LuLock className="icon-lg text-text-muted shrink-0 mt-0.5" />
                    <div>
                        <h2 className="text-sm font-bold text-text-highlighted">
                            You don't have access to workspace settings
                        </h2>
                        <p className="text-sm text-text-muted mt-1">
                            Only admins and the owner of {workspaceName ?? 'this workspace'} can
                            manage its name, members and plan. You're {role === 'viewer' ? 'a viewer' : 'a creator'} here —
                            ask an admin if you need access.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-2xl mx-auto flex flex-col gap-6 pb-16">
            {/* Page header */}
            <div>
                <h1 className="heading-2">Workspace settings</h1>
                <p className="text-sm text-text-muted mt-1">
                    Name, members, and plan for {workspaceName ?? 'your workspace'}.
                </p>
            </div>

            {loading ? (
                <div className={`${SECTION_CARD} flex items-center gap-2 text-text-muted text-sm`}>
                    <LuLoader className="icon-sm animate-spin" /> Loading…
                </div>
            ) : !details ? (
                <p className={`${SECTION_CARD} text-sm text-text-muted`}>Could not load workspace settings.</p>
            ) : (
                <section className={SECTION_CARD}>
                    <GeneralSection details={details} isAdmin={isAdmin} onRenamed={handleRenamed} />
                </section>
            )}

            {/* Plan, seats and members are one story — the seats you buy are the
                seats you hand out — so they share a card instead of cross-linking */}
            <section id="settings-billing" className={`${SECTION_CARD} flex flex-col gap-6`}>
                <h2 className="heading-2">Plan & members</h2>

                <BillingSection
                    usedSeats={usedSeats}
                    reservedSeats={reservedSeats}
                    viewerCount={viewerCount}
                    onSeatsChanged={handleSeatsChanged}
                />

                {details && (
                    <div id="settings-members" className="pt-6 border-t border-border scroll-mt-6">
                        <MembersSection
                            details={details}
                            currentUserId={userId}
                            hasTeamAccess={hasTeamAccess}
                            onMemberRemoved={handleMemberRemoved}
                            onMemberRoleChanged={handleMemberRoleChanged}
                            onInvitationSent={handleInvitationSent}
                            onInvitationRescinded={handleInvitationRescinded}
                        />
                    </div>
                )}
            </section>
        </div>
    );
}
