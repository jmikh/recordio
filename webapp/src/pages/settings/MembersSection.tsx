import { useState } from 'react';
import { LuMail, LuLoader, LuX } from 'react-icons/lu';
import { Button, Dropdown } from '@shared/components';
import { invokeFunction } from '../../api/client';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useToast } from '../../components/Toast';
import { trackWorkspaceInviteFailed } from '../../analytics';
import { captureError } from '../../lib/sentry';
import { PRICE_MONTHLY, PRICE_YEARLY } from '../../billing/prices';
import type { WorkspaceDetails, WorkspaceMember } from './types';

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
            const { error } = await invokeFunction('workspace-member-update-role', {
                workspaceId: details.id,
                userId: member.user_id,
                role,
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

    return (
        <div className="flex items-center gap-3 px-4 py-3 bg-surface">
            <Avatar name={member.name} email={member.email} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-text-highlighted truncate">
                        {member.name ?? member.email}
                    </p>
                    {isCurrentUser && (
                        <span className="text-badge text-text-muted bg-state-inactive px-1.5 py-0.5 rounded-sm uppercase tracking-wide shrink-0">
                            You
                        </span>
                    )}
                </div>
                {member.name && (
                    <p className="text-xs text-text-muted truncate">{member.email}</p>
                )}
            </div>
            <div className="shrink-0">
                {canChangeRole ? (
                    <Dropdown<'viewer' | 'creator' | 'admin' | 'remove'>
                        options={[
                            { value: 'admin', label: 'Admin' },
                            { value: 'creator', label: 'Creator' },
                            { value: 'viewer', label: 'Viewer' },
                            ...(canRemove ? [{ value: 'remove' as const, label: 'Remove', destructive: true }] : []),
                        ]}
                        value={member.role}
                        onChange={value => {
                            if (value === 'remove') { onRemove(member.user_id); return; }
                            handleRoleChange(value);
                        }}
                        ariaLabel="Member role"
                        fullWidth={false}
                        className={updatingRole || removing ? 'pointer-events-none opacity-50' : ''}
                        suffix={(updatingRole || removing) && (
                            <LuLoader className="icon-sm animate-spin text-text-muted" />
                        )}
                    />
                ) : (
                    <span className="text-sm text-text-muted capitalize px-2">{isPlanOwner ? 'Owner' : member.role}</span>
                )}
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MembersSection({ details, currentUserId, hasTeamAccess, onMemberRemoved, onMemberRoleChanged, onInvitationRescinded, onGoToBilling }: {
    details: WorkspaceDetails;
    currentUserId: string | null;
    /** Active subscription — the single plan includes collaboration (billing revamp Step 1) */
    hasTeamAccess: boolean;
    onMemberRemoved: (userId: string) => void;
    onMemberRoleChanged: (userId: string, role: 'viewer' | 'creator' | 'admin') => void;
    onInvitationRescinded: (invitationId: string) => void;
    onGoToBilling?: () => void;
}) {
    const { addToast }                    = useToast();
    const { subscription }                = useWorkspaceStore();
    const [inviteEmail, setInviteEmail]   = useState('');
    const [inviteRole, setInviteRole]     = useState<'viewer' | 'creator'>('creator');
    const [inviting, setInviting]         = useState(false);
    const [removingId, setRemovingId]     = useState<string | null>(null);
    const [rescindingId, setRescindingId] = useState<string | null>(null);
    const [resendingId, setResendingId]   = useState<string | null>(null);

    const isAdmin = details.role === 'admin';

    // Seats are invite-driven derived state (billing revamp Step 6):
    // billed = creator/admin members (the owner is synthesized into the
    // list as admin); viewers are free; each accepted seat invite bills.
    const billedMembers = details.members.filter(m => m.role === 'creator' || m.role === 'admin');
    const viewerMembers = details.members.filter(m => m.role === 'viewer');
    const pendingSeats  = details.invitations.filter(i => i.role !== 'viewer').length;
    const seatPrice     = subscription?.billingInterval === 'yearly' ? PRICE_YEARLY : PRICE_MONTHLY;

    const inputClass = "px-3 py-2 text-sm bg-surface border border-border rounded-[var(--radius-interactive)] text-text-main placeholder:text-text-muted outline-none focus:border-primary transition-colors";

    // ── No active subscription — collaboration is a Pro feature ──────────────
    if (!hasTeamAccess) {
        return (
            <div className="w-full">
                <h2 className="heading-2 mb-2">Members</h2>
                <p className="text-sm text-text-muted">
                    Adding team members is a Pro feature.{' '}
                    <button
                        type="button"
                        className="text-primary hover:underline cursor-pointer"
                        onClick={onGoToBilling}
                    >
                        Upgrade to Pro →
                    </button>
                </p>
            </div>
        );
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        setInviting(true);
        try {
            const { error } = await invokeFunction('workspace-invite', {
                workspaceId: details.id,
                email: inviteEmail.trim().toLowerCase(),
                role: inviteRole,
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
            const { error } = await invokeFunction('workspace-member-remove', {
                workspaceId: details.id,
                userId,
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
            const { error } = await invokeFunction('workspace-invite-rescind', {
                invitationId,
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
            const { error } = await invokeFunction('workspace-invite', {
                workspaceId: details.id,
                email,
                role,
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
        <div className="w-full flex flex-col gap-6">
            {/* Header */}
            <div>
                <h2 className="heading-2">Members</h2>
                <p className="text-sm text-text-muted mt-0.5">Invite teammates and manage their access.</p>
            </div>

            {/* Seat summary — seats are invite-driven (billing revamp Step 6) */}
            <div className="border border-border rounded-md p-5 flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-4">
                    <div>
                        <span className="text-2xl font-bold text-text-highlighted">{billedMembers.length}</span>
                        <span className="text-sm text-text-muted">
                            {' '}{billedMembers.length === 1 ? 'seat' : 'seats'} ·
                            {' '}${billedMembers.length * seatPrice}/mo
                            {subscription?.billingInterval === 'yearly' ? ', billed yearly' : ''}
                        </span>
                    </div>
                    {viewerMembers.length > 0 && (
                        <span className="text-sm text-text-muted">
                            {viewerMembers.length} viewer{viewerMembers.length !== 1 ? 's' : ''} · free
                        </span>
                    )}
                </div>
                <p className="text-xs text-text-muted">
                    Seats adjust automatically as members join or leave.
                    {pendingSeats > 0 && ` ${pendingSeats} pending invite${pendingSeats !== 1 ? 's' : ''} — each adds a seat when accepted.`}
                </p>
            </div>

            {/* Invite form — admin/owner only (billing grows on acceptance) */}
            {isAdmin ? (
                <div className="border border-border rounded-md p-5">
                    <h3 className="text-sm font-bold text-text-highlighted mb-3">Invite a teammate</h3>
                    <form onSubmit={handleInvite} className="flex gap-2">
                        <input
                            type="email"
                            aria-label="Teammate email"
                            placeholder="colleague@example.com"
                            value={inviteEmail}
                            onChange={e => setInviteEmail(e.target.value)}
                            className={`${inputClass} flex-1`}
                        />
                        <Dropdown<'creator' | 'viewer'>
                            options={[
                                { value: 'creator', label: 'Creator' },
                                { value: 'viewer', label: 'Viewer' },
                            ]}
                            value={inviteRole}
                            onChange={setInviteRole}
                            ariaLabel="Invite role"
                            fullWidth={false}
                        />
                        <Button
                            type="submit"
                            variant="primary"
                            disabled={inviting || !inviteEmail.trim()}
                        >
                            {inviting ? 'Sending…' : 'Send Invite'}
                        </Button>
                    </form>
                    <p className="text-xs text-text-muted mt-2">
                        {inviteRole === 'viewer'
                            ? 'Viewers are free — library access only.'
                            : `Each creator seat adds $${seatPrice}/mo, prorated from the day they join.`}
                    </p>
                </div>
            ) : (
                <p className="text-sm text-text-muted">Only workspace admins can invite members.</p>
            )}

            {/* Active members */}
            <div>
                <p className="flex items-baseline gap-1.5 mb-3">
                    <span className="text-eyebrow">Active Members</span>
                    <span className="text-xs text-text-muted">{details.members.length}</span>
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
                    <p className="flex items-baseline gap-1.5 mb-3">
                        <span className="text-eyebrow">Pending Invitations</span>
                        <span className="text-xs text-text-muted">{details.invitations.length}</span>
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
                                        <p className="text-sm text-text-highlighted truncate">{inv.email}</p>
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
