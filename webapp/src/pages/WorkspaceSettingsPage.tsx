import { useState, useEffect } from 'react';
import { LuArrowLeft, LuUsers, LuSettings2, LuTrash2, LuMail, LuLoader } from 'react-icons/lu';
import { Button, Modal } from '@shared/components';
import { supabase } from '../auth/AuthManager';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';
import { useUserStore } from '../editor/stores/useUserStore';
import { useNonFreeAccess } from '../hooks/useNonFreeAccess';
import { useToast } from '../editor/components/Toast';
import { navigate } from '../navigate';

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkspaceMember {
    user_id: string;
    role: 'viewer' | 'creator' | 'admin';
    email: string;
    name: string | null;
    created_at: string;
}

interface WorkspaceInvitation {
    id: string;
    email: string;
    role: 'viewer' | 'creator' | 'admin';
    invited_by: string;
    created_at: string;
    expires_at: string;
}

interface WorkspaceDetails {
    id: string;
    name: string;
    owner_id: string;
    is_personal: boolean;
    role: 'viewer' | 'creator' | 'admin';
    seats: number | null;
    members: WorkspaceMember[];
    invitations: WorkspaceInvitation[];
}

type Tab = 'general' | 'members';

// ─── Sub-components ──────────────────────────────────────────────────────────

function SeatProgressBar({ seats, memberCount, pendingCount }: {
    seats: number;
    memberCount: number;
    pendingCount: number;
}) {
    const memberPct  = Math.min((memberCount / seats) * 100, 100);
    const pendingPct = Math.min(((memberCount + pendingCount) / seats) * 100, 100);
    const available  = Math.max(seats - memberCount - pendingCount, 0);

    return (
        <div>
            <div className="flex items-center justify-between mb-1.5 text-xs text-text-muted">
                <span>
                    <span className="text-success font-medium">{memberCount} active</span>
                    {pendingCount > 0 && (
                        <span className="text-secondary font-medium ml-2">{pendingCount} pending</span>
                    )}
                    <span className="ml-2">/ {seats} seats</span>
                </span>
                <span>{available} available</span>
            </div>
            {/* Layered progress bar: yellow underneath, green on top */}
            <div className="h-2 bg-state-inactive rounded-full overflow-hidden relative">
                {/* Pending layer (yellow) */}
                <div
                    className="absolute inset-y-0 left-0 rounded-full bg-secondary/60 transition-all"
                    style={{ width: `${pendingPct}%` }}
                />
                {/* Active layer (green) */}
                <div
                    className="absolute inset-y-0 left-0 rounded-full bg-success transition-all"
                    style={{ width: `${memberPct}%` }}
                />
            </div>
        </div>
    );
}

// ─── General Tab ─────────────────────────────────────────────────────────────

function GeneralTab({ details, isAdmin, onRenamed }: {
    details: WorkspaceDetails;
    isAdmin: boolean;
    onRenamed: (name: string) => void;
}) {
    const [name, setName]       = useState(details.name);
    const [saving, setSaving]   = useState(false);
    const { addToast }          = useToast();

    const handleSave = async () => {
        const trimmed = name.trim();
        if (!trimmed || trimmed === details.name) return;
        setSaving(true);
        try {
            const { data, error } = await supabase!.rpc('workspace_rename', {
                p_workspace_id: details.id,
                p_name: trimmed,
            });
            if (error) throw error;
            onRenamed(data.name);
            addToast({ type: 'success', title: `Workspace renamed to "${data.name}"` });
        } catch {
            addToast({ type: 'error', title: 'Failed to rename workspace' });
        } finally {
            setSaving(false);
        }
    };

    const inputClass = "w-full px-3 py-2 text-sm bg-surface border border-border rounded-(--radius-interactive) text-text-main placeholder:text-text-muted outline-none focus:border-primary transition-colors";

    return (
        <div className="max-w-lg">
            <h2 className="text-base font-semibold text-text-highlighted mb-6">General</h2>
            <div className="flex flex-col gap-1.5">
                <label className="text-sm text-text-main">Workspace Name</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                        className={inputClass}
                        disabled={!isAdmin}
                        maxLength={60}
                    />
                    {isAdmin && (
                        <Button
                            variant="primary"
                            onClick={handleSave}
                            disabled={saving || !name.trim() || name.trim() === details.name}
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Members Tab ─────────────────────────────────────────────────────────────

function MembersTab({ details, currentUserId, hasNonFreeAccess, onSeatsUpdated, onMemberRemoved }: {
    details: WorkspaceDetails;
    currentUserId: string | null;
    hasNonFreeAccess: boolean;
    onSeatsUpdated: (seats: number) => void;
    onMemberRemoved: (userId: string) => void;
}) {
    const { addToast }                  = useToast();
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole]   = useState<'viewer' | 'creator' | 'admin'>('creator');
    const [inviting, setInviting]       = useState(false);
    const [seatPicker, setSeatPicker]   = useState(5);
    const [settingSeats, setSettingSeats] = useState(false);
    const [removingId, setRemovingId]   = useState<string | null>(null);

    const isAdmin      = details.role === 'admin';
    const memberCount  = details.members.length;
    const pendingCount = details.invitations.length;
    const canInvite    = details.seats != null
        ? memberCount + pendingCount < details.seats
        : false;

    const inputClass = "px-3 py-2 text-sm bg-surface border border-border rounded-(--radius-interactive) text-text-main placeholder:text-text-muted outline-none focus:border-primary transition-colors";

    // ── Upgrade / seat setup ─────────────────────────────────────────────────
    if (!hasNonFreeAccess) {
        return (
            <div className="max-w-lg">
                <h2 className="text-base font-semibold text-text-highlighted mb-2">Members</h2>
                <p className="text-sm text-text-muted mb-6">
                    Team workspaces are available on the Business plan.
                </p>
                <div className="border border-border rounded-lg p-5 flex flex-col gap-4">
                    <p className="text-sm font-medium text-text-highlighted">Upgrade to Business</p>
                    <ul className="flex flex-col gap-2 text-sm text-text-muted">
                        <li className="flex items-center gap-2"><span className="text-success">✓</span> Invite team members</li>
                        <li className="flex items-center gap-2"><span className="text-success">✓</span> Role-based access (viewer, creator, admin)</li>
                        <li className="flex items-center gap-2"><span className="text-success">✓</span> Shared project library</li>
                        <li className="flex items-center gap-2"><span className="text-success">✓</span> Seat management</li>
                    </ul>
                    <Button variant="primary" onClick={() => navigate('/?checkout=yearly')}>
                        Upgrade to Business
                    </Button>
                </div>
            </div>
        );
    }

    // ── Seat setup (Pro, but no seats configured yet) ────────────────────────
    if (details.seats == null) {
        return (
            <div className="max-w-lg">
                <h2 className="text-base font-semibold text-text-highlighted mb-2">Members</h2>
                <p className="text-sm text-text-muted mb-6">
                    Set a seat count to start inviting team members to this workspace.
                </p>
                <div className="border border-border rounded-lg p-5 flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-sm text-text-main">Number of seats</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min={1}
                                max={500}
                                value={seatPicker}
                                onChange={e => setSeatPicker(Math.max(1, parseInt(e.target.value) || 1))}
                                className={`${inputClass} w-24`}
                            />
                            <span className="text-sm text-text-muted">seats</span>
                        </div>
                    </div>
                    <Button
                        variant="primary"
                        disabled={settingSeats}
                        onClick={async () => {
                            setSettingSeats(true);
                            try {
                                const { error } = await supabase!.rpc('workspace_seats_set', {
                                    p_workspace_id: details.id,
                                    p_seats: seatPicker,
                                });
                                if (error) throw error;
                                onSeatsUpdated(seatPicker);
                                addToast({ type: 'success', title: `Team workspace configured with ${seatPicker} seats` });
                            } catch {
                                addToast({ type: 'error', title: 'Failed to configure seats' });
                            } finally {
                                setSettingSeats(false);
                            }
                        }}
                    >
                        {settingSeats ? 'Setting up…' : 'Enable team access'}
                    </Button>
                </div>
            </div>
        );
    }

    // ── Full members management ──────────────────────────────────────────────
    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim() || !canInvite) return;
        setInviting(true);
        try {
            const { error } = await supabase!.rpc('workspace_invite', {
                p_workspace_id: details.id,
                p_email: inviteEmail.trim().toLowerCase(),
                p_role: inviteRole,
            });
            if (error) throw error;
            setInviteEmail('');
            addToast({ type: 'success', title: `Invitation sent to ${inviteEmail.trim()}` });
        } catch (err: any) {
            addToast({ type: 'error', title: err?.message ?? 'Failed to send invitation' });
        } finally {
            setInviting(false);
        }
    };

    const handleRemove = async (userId: string) => {
        setRemovingId(userId);
        try {
            const { error } = await supabase!.rpc('workspace_member_remove', {
                p_workspace_id: details.id,
                p_user_id: userId,
            });
            if (error) throw error;
            onMemberRemoved(userId);
            addToast({ type: 'success', title: 'Member removed' });
        } catch {
            addToast({ type: 'error', title: 'Failed to remove member' });
        } finally {
            setRemovingId(null);
        }
    };

    return (
        <div className="max-w-2xl flex flex-col gap-8">
            <div>
                <h2 className="text-base font-semibold text-text-highlighted mb-4">Members</h2>
                <SeatProgressBar
                    seats={details.seats}
                    memberCount={memberCount}
                    pendingCount={pendingCount}
                />
            </div>

            {/* Invite form */}
            {isAdmin && (
                <div>
                    <h3 className="text-sm font-medium text-text-main mb-3">Invite member</h3>
                    {!canInvite ? (
                        <p className="text-sm text-text-muted">
                            No seats available.{' '}
                            <button
                                type="button"
                                className="text-primary hover:underline cursor-pointer"
                                onClick={async () => {
                                    const newSeats = details.seats! + 5;
                                    setSettingSeats(true);
                                    try {
                                        const { error } = await supabase!.rpc('workspace_seats_set', {
                                            p_workspace_id: details.id,
                                            p_seats: newSeats,
                                        });
                                        if (error) throw error;
                                        onSeatsUpdated(newSeats);
                                        addToast({ type: 'success', title: `Expanded to ${newSeats} seats` });
                                    } catch {
                                        addToast({ type: 'error', title: 'Failed to update seats' });
                                    } finally {
                                        setSettingSeats(false);
                                    }
                                }}
                            >
                                Add 5 more seats
                            </button>
                        </p>
                    ) : (
                        <form onSubmit={handleInvite} className="flex gap-2">
                            <input
                                type="email"
                                placeholder="colleague@example.com"
                                value={inviteEmail}
                                onChange={e => setInviteEmail(e.target.value)}
                                className={`${inputClass} flex-1`}
                            />
                            <select
                                value={inviteRole}
                                onChange={e => setInviteRole(e.target.value as typeof inviteRole)}
                                className={`${inputClass} pr-8`}
                            >
                                <option value="viewer">Viewer</option>
                                <option value="creator">Creator</option>
                                <option value="admin">Admin</option>
                            </select>
                            <Button type="submit" variant="primary" disabled={inviting || !inviteEmail.trim()}>
                                {inviting ? 'Sending…' : 'Invite'}
                            </Button>
                        </form>
                    )}
                </div>
            )}

            {/* Member list */}
            <div>
                <h3 className="text-sm font-medium text-text-main mb-3">
                    Active members <span className="text-text-muted font-normal">({memberCount})</span>
                </h3>
                <div className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden">
                    {details.members.map(member => (
                        <div key={member.user_id} className="flex items-center gap-3 px-4 py-3 bg-surface">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-text-highlighted truncate">
                                    {member.name ?? member.email}
                                    {member.user_id === currentUserId && (
                                        <span className="ml-1.5 text-[10px] text-text-muted font-normal">(you)</span>
                                    )}
                                </p>
                                {member.name && (
                                    <p className="text-xs text-text-muted truncate">{member.email}</p>
                                )}
                            </div>
                            <span className="text-xs text-text-muted capitalize shrink-0">{member.role}</span>
                            {isAdmin && member.user_id !== details.owner_id && member.user_id !== currentUserId && (
                                <Button
                                    variant="icon"
                                    icon={removingId === member.user_id ? LuLoader : LuTrash2}
                                    onClick={() => handleRemove(member.user_id)}
                                    disabled={removingId === member.user_id}
                                    title="Remove member"
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Pending invitations */}
            {details.invitations.length > 0 && (
                <div>
                    <h3 className="text-sm font-medium text-text-main mb-3">
                        Pending invitations <span className="text-text-muted font-normal">({pendingCount})</span>
                    </h3>
                    <div className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden">
                        {details.invitations.map(inv => (
                            <div key={inv.id} className="flex items-center gap-3 px-4 py-3 bg-surface">
                                <LuMail className="icon-sm shrink-0 text-secondary" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-text-main truncate">{inv.email}</p>
                                    <p className="text-xs text-text-muted">
                                        {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function WorkspaceSettingsPage() {
    const { workspaceId, workspaceName, workspaceRole, workspaceIsPersonal, setWorkspace, workspaceOwnerId, workspaceSeats } = useWorkspaceStore();
    const { userId } = useUserStore();
    const hasNonFreeAccess = useNonFreeAccess();
    const { addToast } = useToast();

    const [activeTab, setActiveTab]     = useState<Tab>('general');
    const [details, setDetails]         = useState<WorkspaceDetails | null>(null);
    const [loading, setLoading]         = useState(true);

    const isAdmin = workspaceRole === 'admin';

    useEffect(() => {
        if (!workspaceId || !supabase) return;
        setLoading(true);
        supabase.rpc('workspace_get', { p_workspace_id: workspaceId })
            .then(({ data, error }) => {
                if (!error && data) setDetails(data as WorkspaceDetails);
                else addToast({ type: 'error', title: 'Failed to load workspace' });
            })
            .finally(() => setLoading(false));
    }, [workspaceId]);

    const handleRenamed = (name: string) => {
        if (!workspaceId || !workspaceOwnerId) return;
        setWorkspace(workspaceId, name, workspaceOwnerId, workspaceRole, workspaceIsPersonal, workspaceSeats);
        setDetails(prev => prev ? { ...prev, name } : prev);
    };

    const handleSeatsUpdated = (seats: number) => {
        if (!workspaceId || !workspaceOwnerId) return;
        setWorkspace(workspaceId, workspaceName!, workspaceOwnerId, workspaceRole, workspaceIsPersonal, seats);
        setDetails(prev => prev ? { ...prev, seats } : prev);
    };

    const handleMemberRemoved = (removedUserId: string) => {
        setDetails(prev => prev
            ? { ...prev, members: prev.members.filter(m => m.user_id !== removedUserId) }
            : prev
        );
    };

    const tabs: { id: Tab; label: string; icon: typeof LuSettings2 }[] = [
        { id: 'general', label: 'General', icon: LuSettings2 },
        ...(!workspaceIsPersonal ? [{ id: 'members' as Tab, label: 'Members', icon: LuUsers }] : []),
    ];

    return (
        <div className="min-h-screen bg-surface-body text-text-main flex flex-col">
            {/* Top bar */}
            <div className="border-b border-border px-6 py-3 flex items-center gap-3">
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
                                onClick={() => setActiveTab(tab.id)}
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

                {/* Content */}
                <main className="flex-1 overflow-y-auto p-8">
                    {loading ? (
                        <div className="flex items-center justify-center h-32 text-text-muted text-sm">
                            Loading…
                        </div>
                    ) : !details ? (
                        <div className="text-sm text-text-muted">Could not load workspace settings.</div>
                    ) : activeTab === 'general' ? (
                        <GeneralTab details={details} isAdmin={isAdmin} onRenamed={handleRenamed} />
                    ) : (
                        <MembersTab
                            details={details}
                            currentUserId={userId}
                            hasNonFreeAccess={hasNonFreeAccess}
                            onSeatsUpdated={handleSeatsUpdated}
                            onMemberRemoved={handleMemberRemoved}
                        />
                    )}
                </main>
            </div>
        </div>
    );
}
