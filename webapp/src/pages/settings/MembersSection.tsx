import { useState } from 'react';
import { LuLoader, LuMail, LuX } from 'react-icons/lu';
import { Button, Dropdown } from '@shared/components';
import { apiErrorMessage, invokeFunction } from '../../api/client';
import { useWorkspaceStore } from '../../workspace/useWorkspaceStore';
import { useToast } from '../../components/Toast';
import { trackWorkspaceInviteFailed } from '../../analytics';
import { captureError } from '../../lib/sentry';
import { PRICE_MONTHLY, PRICE_YEARLY } from '../../billing/prices';
import type { WorkspaceDetails, WorkspaceInvitation, WorkspaceMember } from './types';

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
            // Promotions can be refused for lack of a free purchased seat —
            // show the server's reason
            addToast({ type: 'error', title: await apiErrorMessage(err, 'Failed to update role') });
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

export function MembersSection({ details, currentUserId, hasTeamAccess, onMemberRemoved, onMemberRoleChanged, onInvitationSent, onInvitationRescinded, onGoToBilling }: {
    details: WorkspaceDetails;
    currentUserId: string | null;
    /** Active subscription — the single plan includes collaboration (billing revamp Step 1) */
    hasTeamAccess: boolean;
    onMemberRemoved: (userId: string) => void;
    onMemberRoleChanged: (userId: string, role: 'viewer' | 'creator' | 'admin') => void;
    /** A sent or resent invitation (replaces any prior one for the email) */
    onInvitationSent: (invitation: WorkspaceInvitation) => void;
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

    // Seat pre-purchase (plans/seat-prepurchase-oneshot.md): purchased =
    // subscription seats; used = creator/admin members (the owner is
    // synthesized into the list as admin); pending creator/admin
    // invitations reserve a seat; viewers are free.
    const purchasedSeats = details.seats ?? 0;
    const usedSeats      = details.members.filter(m => m.role === 'creator' || m.role === 'admin').length;
    const reservedSeats  = details.invitations.filter(i => i.role !== 'viewer').length;
    const availableSeats = Math.max(0, purchasedSeats - usedSeats - reservedSeats);
    const noSeatLeft     = availableSeats === 0;
    const viewerMembers  = details.members.filter(m => m.role === 'viewer');
    const seatPrice      = subscription?.billingInterval === 'yearly' ? PRICE_YEARLY : PRICE_MONTHLY;
    // With every seat taken, the creator option is disabled — fall back to viewer
    const effectiveInviteRole: 'viewer' | 'creator' = noSeatLeft && inviteRole === 'creator' ? 'viewer' : inviteRole;
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
        const email = inviteEmail.trim().toLowerCase();
        if (!email) return;
        setInviting(true);
        try {
            const { data, error } = await invokeFunction('workspace-invite', {
                workspaceId: details.id,
                email,
                role: effectiveInviteRole,
            });
            if (error) throw error;
            setInviteEmail('');
            onInvitationSent({
                id: data.invitationId,
                email,
                role: effectiveInviteRole,
                invited_by: currentUserId ?? '',
                created_at: new Date().toISOString(),
            });
            addToast({ type: 'success', title: `Invitation sent to ${email}` });
        } catch (err) {
            const failure = err instanceof Error ? err : undefined;
            captureError(err, { flow: 'workspace', phase: 'invite', workspaceId: details.id, extra: { role: effectiveInviteRole } });
            trackWorkspaceInviteFailed({
                workspace_id: details.id,
                role: effectiveInviteRole,
                error: failure?.message || 'Unknown error',
                error_name: failure?.name,
                is_offline: !navigator.onLine,
            });
            addToast({ type: 'error', title: await apiErrorMessage(err, 'Failed to send invitation') });
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
            const { data, error } = await invokeFunction('workspace-invite', {
                workspaceId: details.id,
                email,
                role,
            });
            if (error) throw error;
            onInvitationSent({
                id: data.invitationId,
                email,
                role,
                invited_by: currentUserId ?? '',
                created_at: new Date().toISOString(),
            });
            addToast({ type: 'success', title: `Invitation resent to ${email}` });
        } catch (err) {
            captureError(err, { flow: 'workspace', phase: 'invite_resend', workspaceId: details.id, extra: { role } });
            addToast({ type: 'error', title: await apiErrorMessage(err, 'Failed to resend invitation') });
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

            {/* Seat summary — purchased seats vs. seats in use / reserved */}
            <div className="border border-border rounded-[var(--radius-md)] p-5 flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    <p className="text-sm text-text-muted">
                        <span className="text-2xl font-bold text-text-highlighted">{usedSeats}</span>
                        {' '}of {plural(purchasedSeats, 'seat')} used ·
                        {' '}${purchasedSeats * seatPrice}/mo
                        {subscription?.billingInterval === 'yearly' ? ', billed yearly' : ''}
                    </p>
                    {viewerMembers.length > 0 && (
                        <span className="text-sm text-text-muted">
                            {plural(viewerMembers.length, 'viewer')} · free
                        </span>
                    )}
                </div>
                <p className="text-xs text-text-muted">
                    {reservedSeats > 0 && `${reservedSeats} reserved by pending ${reservedSeats === 1 ? 'invite' : 'invites'}. `}
                    {noSeatLeft
                        ? 'All purchased seats are taken.'
                        : `${plural(availableSeats, 'seat')} available for new creators or admins.`}
                    {isAdmin && (
                        <>
                            {' '}
                            <button
                                type="button"
                                className="text-primary hover:underline cursor-pointer"
                                onClick={onGoToBilling}
                            >
                                {noSeatLeft ? 'Add seats →' : 'Manage seats →'}
                            </button>
                        </>
                    )}
                </p>
            </div>

            {/* Invite form — admin/owner only; creators need a free purchased seat */}
            {isAdmin ? (
                <div className="border border-border rounded-[var(--radius-md)] p-5">
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
                                { value: 'creator', label: 'Creator', disabled: noSeatLeft },
                                { value: 'viewer', label: 'Viewer' },
                            ]}
                            value={effectiveInviteRole}
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
                        {noSeatLeft
                            ? 'No creator seats available — add seats to invite more creators.'
                            : effectiveInviteRole === 'viewer'
                                ? 'Viewers are free — library access only.'
                                : `Uses 1 of your ${plural(purchasedSeats, 'purchased seat')} (${availableSeats} available).`}
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
                <div className="flex flex-col divide-y divide-border border border-border rounded-[var(--radius-md)] overflow-hidden">
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
                                <div key={inv.id} className="flex items-center gap-3 px-4 py-3 border border-dashed border-border rounded-[var(--radius-md)]">
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
                                                variant="ghost"
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
