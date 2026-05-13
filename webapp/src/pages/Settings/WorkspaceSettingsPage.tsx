import { useState, useEffect } from 'react';
import { LuArrowLeft, LuUsers, LuSettings2, LuCreditCard, LuLoader } from 'react-icons/lu';
import { Button } from '@shared/components';
import { supabase } from '../../auth/AuthManager';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useUserStore } from '../../editor/stores/useUserStore';
import { useToast } from '../../editor/components/Toast';
import { navigate } from '../../navigate';
import { GeneralPage } from './GeneralPage';
import { MembersPage } from './MembersPage';
import { BillingPage } from './BillingPage';
import type { Tab, WorkspaceDetails } from './types';

export function WorkspaceSettingsPage() {
    const { workspaceId, workspaceName, workspaceRole, setWorkspace, workspaceOwnerId, workspaceSeats, hasActivePlan, subscription } = useWorkspaceStore();
    const { userId } = useUserStore();
    const { addToast } = useToast();

    const isTeamsPlan = hasActivePlan && subscription?.plan === 'teams';

    const activeTab = ((): Tab => {
        const seg = window.location.pathname.split('/').pop();
        if (seg === 'billing' || seg === 'members') return seg;
        return 'general';
    })();

    const goToTab = (tab: Tab) => navigate(`/workspace/settings/${tab}`);

    const [details, setDetails] = useState<WorkspaceDetails | null>(null);
    const [loading, setLoading] = useState(true);

    const isAdmin = workspaceRole === 'admin';

    useEffect(() => {
        if (!workspaceId || !supabase) return;
        setLoading(true);
        (async () => {
            try {
                const { data, error } = await supabase!.rpc('workspace_get', { p_workspace_id: workspaceId });
                if (!error && data) setDetails(data as WorkspaceDetails);
                else addToast({ type: 'error', title: 'Failed to load workspace' });
            } catch {
                addToast({ type: 'error', title: 'Failed to load workspace' });
            } finally {
                setLoading(false);
            }
        })();
    }, [workspaceId]);

    const handleRenamed = (name: string) => {
        if (!workspaceId || !workspaceOwnerId) return;
        setWorkspace(workspaceId, name, workspaceOwnerId, workspaceRole, workspaceSeats);
        setDetails(prev => prev ? { ...prev, name } : prev);
    };

    const handleSeatsUpdated = (seats: number) => {
        if (!workspaceId || !workspaceOwnerId) return;
        setWorkspace(workspaceId, workspaceName!, workspaceOwnerId, workspaceRole, seats);
        setDetails(prev => prev ? { ...prev, seats } : prev);
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

    const tabs: { id: Tab; label: string; icon: typeof LuSettings2 }[] = [
        { id: 'general',  label: 'General',         icon: LuSettings2  },
        { id: 'members',  label: 'Members',          icon: LuUsers      },
        { id: 'billing',  label: 'Plans & Billing',  icon: LuCreditCard },
    ];

    const renderContent = () => {
        if (activeTab === 'billing') {
            return (
                <BillingPage
                    seatFloor={details
                        ? Math.max(1,
                            details.members.filter(m => m.role !== 'viewer').length +
                            details.invitations.filter(i => i.role !== 'viewer').length
                          )
                        : 1
                    }
                    onGoToMembers={() => goToTab('members')}
                />
            );
        }

        if (loading) {
            return (
                <div className="flex items-center gap-2 text-text-muted text-sm">
                    <LuLoader className="icon-sm animate-spin" /> Loading…
                </div>
            );
        }

        if (!details) {
            return <p className="text-sm text-text-muted">Could not load workspace settings.</p>;
        }

        if (activeTab === 'general') {
            return <GeneralPage details={details} isAdmin={isAdmin} onRenamed={handleRenamed} />;
        }

        return (
            <MembersPage
                details={details}
                currentUserId={userId}
                isTeamsPlan={isTeamsPlan}
                onSeatsUpdated={handleSeatsUpdated}
                onMemberRemoved={handleMemberRemoved}
                onMemberRoleChanged={handleMemberRoleChanged}
                onInvitationRescinded={handleInvitationRescinded}
                onGoToBilling={() => goToTab('billing')}
            />
        );
    };

    return (
        <div className="min-h-screen bg-surface-body text-text-main flex flex-col">
            {/* Top bar */}
            <div className="h-header border-b border-border px-6 flex items-center gap-3">
                <Button variant="icon" icon={LuArrowLeft} onClick={() => navigate('/')} title="Back to Dashboard" />
                <div>
                    <p className="text-xs text-text-muted">Workspace</p>
                    <h1 className="text-sm font-semibold text-text-highlighted leading-tight">
                        {workspaceName ?? 'Workspace Settings'}
                    </h1>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar nav */}
                <aside className="w-52 shrink-0 border-r border-border py-4 px-2 flex flex-col gap-0.5">
                    {tabs.map(tab => {
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => goToTab(tab.id)}
                                className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                                    active
                                        ? 'bg-primary/10 text-primary font-medium'
                                        : 'text-text-main hover:bg-state-hover'
                                }`}
                            >
                                <tab.icon className="icon-sm shrink-0" />
                                {tab.label}
                            </button>
                        );
                    })}
                </aside>

                {/* Content — centered in the available space */}
                <main className="flex-1 overflow-y-auto flex justify-center">
                    <div className="w-full p-8 flex justify-center">
                        {renderContent()}
                    </div>
                </main>
            </div>
        </div>
    );
}
