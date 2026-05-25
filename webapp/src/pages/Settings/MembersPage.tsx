import { useState, useRef, useEffect } from 'react';
import { LuMail, LuLoader, LuX, LuEllipsis } from 'react-icons/lu';
import { Button } from '@shared/components';
import { supabase } from '../../auth/AuthManager';
import { useToast } from '../../editor/components/Toast';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { trackMembersPageLoaded, trackWorkspaceSeatsSetFailed, trackWorkspaceInviteFailed } from '../../core/analytics';
import { captureError } from '../../utils/sentry';
import type { WorkspaceDetails, WorkspaceMember } from './types';

const VIEWER_SEATS_PER_CREATOR = 10;

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name, email }: { name: string | null; email: string }) {
    const text = name ?? email;
    const initials = text
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join('');
    return (
        <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold shrink-0">
            {initials || '?'}
        </div>
    );
}

// ── Seat panel ────────────────────────────────────────────────────────────────

function SeatPanel({ label, sublabel, used, pending, total, note }: {
    label: string;
    sublabel: string;
    used: number;
    pending: number;
    total: number;
    note?: string;
}) {
    const activePct  = Math.min((used / Math.max(total, 1)) * 100, 100);
    const pendingPct = Math.min(((used + pending) / Math.max(total, 1)) * 100, 100);
    const available  = Math.max(total - used - pending, 0);

    return (
        <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                {label}{' '}
                <span className="font-normal normal-case tracking-normal">· {sublabel}</span>
            </p>
            <div className="flex items-baseline justify-between mb-2">
                <div>
                    <span className="text-2xl font-bold text-text-highlighted">{used}</span>
                    <span className="text-sm text-text-muted"> of {total}</span>
                </div>
                <span className="text-sm text-text-muted">{available} available</span>
            </div>
            <div className="h-1.5 bg-state-inactive rounded-full overflow-hidden relative mb-2">
                <div
                    className="absolute inset-y-0 left-0 rounded-full bg-primary/30 transition-all"
                    style={{ width: `${pendingPct}%` }}
                />
                <div
                    className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
                    style={{ width: `${activePct}%` }}
                />
            </div>
            {note ? (
                <p className="text-xs text-text-muted">{note}</p>
            ) : (
                <div className="flex items-center gap-4 text-xs text-text-muted">
                    <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-xs bg-primary inline-block shrink-0" />
                        {used} active
                    </span>
                    {pending > 0 && (
                        <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-xs bg-primary/30 inline-block shrink-0" />
                            {pending} pending
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Member action menu ────────────────────────────────────────────────────────

function MemberActionMenu({ onRemove, removing }: { onRemove: () => void; removing: boolean }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    return (
        <div className="relative" ref={ref}>
            <Button
                variant="icon"
                icon={removing ? LuLoader : LuEllipsis}
                onClick={() => setOpen(prev => !prev)}
                disabled={removing}
            />
            {open && (
                <div className="absolute right-0 top-full mt-1 bg-surface-raised border border-border rounded-md shadow-float py-1 z-10 min-w-37">
                    <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-state-hover cursor-pointer"
                        onClick={() => { setOpen(false); onRemove(); }}
                    >
                        Remove member
                    </button>
                </div>
            )}
        </div>
    );
}

// ── Member row ────────────────────────────────────────────────────────────────

function MemberRow({ member, isCurrentUser, isPlanOwner, isAdmin, details, onRoleChanged, onRemove, removing }: {
    member: WorkspaceMember;
    isCurrentUser: boolean;
    isPlanOwner: boolean;
    isAdmin: boolean;
    details: WorkspaceDetails;
    onRoleChanged: (userId: string, role: 'viewer' | 'creator' | 'admin') => void;
    onRemove: (userId: string) => void;
    removing: boolean;
}) {
    const [updatingRole, setUpdatingRole] = useState(false);
    const { addToast } = useToast();

    const canChangeRole = isAdmin && !isPlanOwner;
    const canRemove     = isAdmin && !isPlanOwner && !isCurrentUser;

    const handleRoleChange = async (role: 'viewer' | 'creator' | 'admin') => {
        if (role === member.role) return;
        setUpdatingRole(true);
        try {
            const { error } = await supabase!.rpc('workspace_member_update_role', {
                p_workspace_id: details.id,
                p_user_id: member.user_id,
                p_role: role,
            });
            if (error) throw error;
            onRoleChanged(member.user_id, role);
        } catch (err) {
            captureError(err, {
                flow: 'workspace',
                phase: 'role_update',
                workspaceId: details.id,
                extra: { targetRole: role, targetUserId: member.user_id },
            });
            addToast({ type: 'error', title: 'Failed to update role' });
        } finally {
            setUpdatingRole(false);
        }
    };

    const inputClass = "text-sm bg-surface border border-border rounded-[var(--radius-interactive)] text-text-main outline-none focus:border-primary transition-colors py-1.5 pl-2.5 pr-7 appearance-none cursor-pointer";

    return (
        <div className="flex items-center gap-3 px-4 py-3 bg-surface">
            <Avatar name={member.name} email={member.email} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-text-highlighted truncate">
                        {member.name ?? member.email}
                    </p>
                    {isCurrentUser && (
                        <span className="text-[10px] font-semibold text-text-muted bg-state-inactive px-1.5 py-0.5 rounded-sm uppercase tracking-wide shrink-0">
                            You
                        </span>
                    )}
                    {isPlanOwner && (
                        <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-sm uppercase tracking-wide shrink-0">
                            Plan Owner
                        </span>
                    )}
                </div>
                {member.name && (
                    <p className="text-xs text-text-muted truncate">{member.email}</p>
                )}
            </div>
            <div className="relative shrink-0">
                {canChangeRole ? (
                    <>
                        <select
                            value={member.role}
                            disabled={updatingRole}
                            onChange={e => handleRoleChange(e.target.value as 'viewer' | 'creator' | 'admin')}
                            className={inputClass}
                        >
                            <option value="admin">Admin</option>
                            <option value="creator">Creator</option>
                            <option value="viewer">Viewer</option>
                        </select>
                        {updatingRole && (
                            <LuLoader className="icon-sm animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                        )}
                    </>
                ) : (
                    <span className="text-sm text-text-muted capitalize px-2">{member.role}</span>
                )}
            </div>
            {canRemove ? (
                <MemberActionMenu onRemove={() => onRemove(member.user_id)} removing={removing} />
            ) : (
                /* preserve layout alignment */
                <div className="w-8" />
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MembersPage({ details, currentUserId, isTeamsPlan, onSeatsUpdated, onMemberRemoved, onMemberRoleChanged, onInvitationRescinded, onGoToBilling }: {
    details: WorkspaceDetails;
    currentUserId: string | null;
    isTeamsPlan: boolean;
    onSeatsUpdated: (seats: number) => void;
    onMemberRemoved: (userId: string) => void;
    onMemberRoleChanged: (userId: string, role: 'viewer' | 'creator' | 'admin') => void;
    onInvitationRescinded: (invitationId: string) => void;
    onGoToBilling?: () => void;
}) {
    const { addToast }                    = useToast();
    useEffect(() => { trackMembersPageLoaded(useWorkspaceStore.getState().workspaceId); }, []);
    const [inviteEmail, setInviteEmail]   = useState('');
    const [inviteRole, setInviteRole]     = useState<'viewer' | 'creator'>('creator');
    const [inviting, setInviting]         = useState(false);
    const [seatPicker, setSeatPicker]     = useState(5);
    const [settingSeats, setSettingSeats] = useState(false);
    const [removingId, setRemovingId]     = useState<string | null>(null);
    const [rescindingId, setRescindingId] = useState<string | null>(null);
    const [resendingId, setResendingId]   = useState<string | null>(null);

    const isAdmin       = details.role === 'admin';
    const creatorSeats  = details.seats ?? 0;
    const viewerSeats   = details.viewer_seats ?? creatorSeats * VIEWER_SEATS_PER_CREATOR;

    const creatorMembers  = details.members.filter(m => m.role === 'creator' || m.role === 'admin');
    const viewerMembers   = details.members.filter(m => m.role === 'viewer');
    const creatorPending  = details.invitations.filter(i => i.role === 'creator' || i.role === 'admin');
    const viewerPending   = details.invitations.filter(i => i.role === 'viewer');

    const availCreator = Math.max(creatorSeats - creatorMembers.length - creatorPending.length, 0);
    const availViewer  = Math.max(viewerSeats  - viewerMembers.length  - viewerPending.length,  0);
    const availForRole = inviteRole === 'viewer' ? availViewer : availCreator;
    const canInvite    = details.seats != null && availForRole > 0;

    const inputClass = "px-3 py-2 text-sm bg-surface border border-border rounded-[var(--radius-interactive)] text-text-main placeholder:text-text-muted outline-none focus:border-primary transition-colors";

    // ── Not on Teams plan ────────────────────────────────────────────────────
    if (!isTeamsPlan) {
        return (
            <div className="w-full max-w-lg">
                <h2 className="text-base font-semibold text-text-highlighted mb-2">Members</h2>
                <p className="text-sm text-text-muted">
                    Adding team members is a Teams plan feature.{' '}
                    <button
                        type="button"
                        className="text-primary font-medium hover:underline cursor-pointer"
                        onClick={onGoToBilling}
                    >
                        Upgrade to Teams →
                    </button>
                </p>
            </div>
        );
    }

    // ── Seat setup (Teams plan, no seats configured yet) ─────────────────────
    if (details.seats == null) {
        return (
            <div className="w-full max-w-lg">
                <h2 className="text-base font-semibold text-text-highlighted mb-2">Members</h2>
                <p className="text-sm text-text-muted mb-6">
                    Set a seat count to start inviting team members to this workspace.
                </p>
                <div className="border border-border rounded-md p-5 flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-sm text-text-main">Number of creator seats</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min={1}
                                max={500}
                                value={seatPicker}
                                onChange={e => setSeatPicker(Math.max(1, parseInt(e.target.value) || 1))}
                                className={`${inputClass} w-24`}
                            />
                            <span className="text-sm text-text-muted">
                                seats · {seatPicker * VIEWER_SEATS_PER_CREATOR} viewer seats included
                            </span>
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
                                addToast({ type: 'success', title: `Team workspace configured with ${seatPicker} creator seats` });
                            } catch (err: any) {
                                captureError(err, { flow: 'workspace', phase: 'seats_set', workspaceId: details.id, extra: { seats: seatPicker } });
                                trackWorkspaceSeatsSetFailed({
                                    workspace_id: details.id,
                                    seats: seatPicker,
                                    error: err?.message || 'Unknown error',
                                    error_name: err?.name,
                                    is_offline: !navigator.onLine,
                                });
                                addToast({ type: 'error', title: 'Failed to configure seats' });
                            } finally {
                                setSettingSeats(false);
                            }
                        }}
                    >
                        {settingSeats ? 'Setting up…' : 'Set up team access'}
                    </Button>
                </div>
            </div>
        );
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

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
            captureError(err, { flow: 'workspace', phase: 'invite', workspaceId: details.id, extra: { role: inviteRole } });
            trackWorkspaceInviteFailed({
                workspace_id: details.id,
                role: inviteRole,
                error: err?.message || 'Unknown error',
                error_name: err?.name,
                is_offline: !navigator.onLine,
            });
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
        } catch (err) {
            captureError(err, { flow: 'workspace', phase: 'member_remove', workspaceId: details.id, extra: { targetUserId: userId } });
            addToast({ type: 'error', title: 'Failed to remove member' });
        } finally {
            setRemovingId(null);
        }
    };

    const handleRescind = async (invitationId: string, email: string) => {
        setRescindingId(invitationId);
        try {
            const { error } = await supabase!.rpc('workspace_invite_rescind', {
                p_invitation_id: invitationId,
            });
            if (error) throw error;
            onInvitationRescinded(invitationId);
            addToast({ type: 'success', title: `Invitation to ${email} cancelled` });
        } catch (err) {
            captureError(err, { flow: 'workspace', phase: 'invite_rescind', workspaceId: details.id, extra: { invitationId } });
            addToast({ type: 'error', title: 'Failed to cancel invitation' });
        } finally {
            setRescindingId(null);
        }
    };

    const handleResend = async (email: string, role: 'viewer' | 'creator' | 'admin') => {
        setResendingId(email);
        try {
            const { error } = await supabase!.rpc('workspace_invite', {
                p_workspace_id: details.id,
                p_email: email,
                p_role: role,
            });
            if (error) throw error;
            addToast({ type: 'success', title: `Invitation resent to ${email}` });
        } catch (err) {
            captureError(err, { flow: 'workspace', phase: 'invite_resend', workspaceId: details.id, extra: { role } });
            addToast({ type: 'error', title: 'Failed to resend invitation' });
        } finally {
            setResendingId(null);
        }
    };

    // ── Full members UI ───────────────────────────────────────────────────────

    return (
        <div className="w-full max-w-2xl flex flex-col gap-6">
            {/* Header */}
            <div>
                <h2 className="text-xl font-semibold text-text-highlighted">Members</h2>
                <p className="text-sm text-text-muted mt-0.5">Invite teammates and manage their access.</p>
            </div>

            {/* Seat panels */}
            <div className="border border-border rounded-md p-5 grid grid-cols-2 gap-5">
                <SeatPanel
                    label="Creator Seats"
                    sublabel="record & edit"
                    used={creatorMembers.length}
                    pending={creatorPending.length}
                    total={creatorSeats}
                />
                <div className="border-l border-border pl-5">
                    <SeatPanel
                        label="Viewer Seats"
                        sublabel="library access only"
                        used={viewerMembers.length}
                        pending={viewerPending.length}
                        total={viewerSeats}
                        note={`${VIEWER_SEATS_PER_CREATOR} viewer seats per creator on Teams. Included free.`}
                    />
                </div>
            </div>

            {/* Invite form */}
            {isAdmin && (
                <div className="border border-border rounded-md p-5">
                    <h3 className="text-sm font-semibold text-text-highlighted mb-3">Invite a teammate</h3>
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
                            onChange={e => setInviteRole(e.target.value as 'viewer' | 'creator')}
                            className={`${inputClass} pr-8`}
                        >
                            <option value="creator">Creator</option>
                            <option value="viewer">Viewer</option>
                        </select>
                        <Button
                            type="submit"
                            variant="primary"
                            disabled={inviting || !inviteEmail.trim() || !canInvite}
                        >
                            {inviting ? 'Sending…' : 'Send Invite'}
                        </Button>
                    </form>
                    {!canInvite && (
                        <p className="text-sm text-text-muted mt-2">
                            No {inviteRole} seats available.{' '}
                            <button
                                type="button"
                                className="text-primary hover:underline cursor-pointer"
                                onClick={onGoToBilling}
                            >
                                Upgrade seats →
                            </button>
                        </p>
                    )}
                </div>
            )}

            {/* Active members */}
            <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                    Active Members{' '}
                    <span className="font-normal normal-case tracking-normal">{details.members.length}</span>
                </p>
                <div className="flex flex-col divide-y divide-border border border-border rounded-md overflow-hidden">
                    {details.members.map(member => (
                        <MemberRow
                            key={member.user_id}
                            member={member}
                            isCurrentUser={member.user_id === currentUserId}
                            isPlanOwner={member.user_id === details.owner_id}
                            isAdmin={isAdmin}
                            details={details}
                            onRoleChanged={onMemberRoleChanged}
                            onRemove={handleRemove}
                            removing={removingId === member.user_id}
                        />
                    ))}
                </div>
            </div>

            {/* Pending invitations */}
            {details.invitations.length > 0 && (
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted mb-3">
                        Pending Invitations{' '}
                        <span className="font-normal normal-case tracking-normal">{details.invitations.length}</span>
                    </p>
                    <div className="flex flex-col gap-2">
                        {details.invitations.map(inv => {
                            const invitedDate = new Date(inv.created_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                            const isRescinding = rescindingId === inv.id;
                            const isResending  = resendingId === inv.email;
                            return (
                                <div key={inv.id} className="flex items-center gap-3 px-4 py-3 border border-dashed border-border rounded-md">
                                    <div className="w-9 h-9 rounded-full bg-state-inactive flex items-center justify-center shrink-0">
                                        <LuMail className="icon-sm text-text-muted" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-text-highlighted truncate">{inv.email}</p>
                                        <p className="text-xs text-text-muted capitalize">
                                            {inv.role} · invited {invitedDate}
                                        </p>
                                    </div>
                                    {isAdmin && (
                                        <div className="flex items-center gap-1 shrink-0">
                                            <Button
                                                variant="base"
                                                disabled={isResending || isRescinding}
                                                onClick={() => handleResend(inv.email, inv.role)}
                                            >
                                                {isResending ? <LuLoader className="icon-sm animate-spin" /> : 'Resend'}
                                            </Button>
                                            <Button
                                                variant="icon"
                                                icon={isRescinding ? LuLoader : LuX}
                                                disabled={isRescinding || isResending}
                                                onClick={() => handleRescind(inv.id, inv.email)}
                                                title="Cancel invitation"
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
