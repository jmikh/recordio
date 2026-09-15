import { useState } from 'react';
import { LuCircleAlert, LuInfo, LuLoader, LuMail, LuMailX, LuX } from 'react-icons/lu';
import { Button, Dropdown, Modal } from '@shared/components';
import { apiErrorMessage, invokeFunction } from '../../api/client';
import { useToast } from '../../components/Toast';
import { trackWorkspaceInviteFailed } from '../../analytics';
import { captureError } from '../../lib/sentry';
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

// ── Invitation failure modal ──────────────────────────────────────────────────

/**
 * Invite failures carry a reason the admin has to act on (seat limits, an
 * already-invited address, a member that already exists), so they get a
 * dismissible modal rather than a toast that scrolls away.
 */
function InviteFailedModal({ failure, onClose }: {
    failure: { email: string; message: string; resend: boolean };
    onClose: () => void;
}) {
    return (
        <Modal isOpen onClose={onClose} maxWidth="max-w-[460px]" ariaLabel="Invitation failed">
            <div className="flex items-center gap-3 mb-4">
                <LuMailX className="icon-lg text-destructive shrink-0" />
                <h2 className="heading-2">
                    {failure.resend ? 'Failed to resend invitation' : 'Failed to send invitation'}
                </h2>
            </div>

            <p className="text-sm text-text-main mb-2">
                We couldn’t invite <span className="text-text-highlighted">{failure.email}</span> to this workspace.
            </p>

            <div
                role="alert"
                className="bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 rounded-[var(--radius-sm)] text-xs mb-6"
            >
                {failure.message}
            </div>

            <Button variant="primary" onClick={onClose} className="w-full">
                Close
            </Button>
        </Modal>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MembersSection({ details, currentUserId, hasTeamAccess, onMemberRemoved, onMemberRoleChanged, onInvitationSent, onInvitationRescinded }: {
    details: WorkspaceDetails;
    currentUserId: string | null;
    /** Active subscription — the single plan includes collaboration (billing revamp Step 1) */
    hasTeamAccess: boolean;
    onMemberRemoved: (userId: string) => void;
    onMemberRoleChanged: (userId: string, role: 'viewer' | 'creator' | 'admin') => void;
    /** A sent or resent invitation (replaces any prior one for the email) */
    onInvitationSent: (invitation: WorkspaceInvitation) => void;
    onInvitationRescinded: (invitationId: string) => void;
}) {
    const { addToast }                    = useToast();
    const [inviteEmail, setInviteEmail]   = useState('');
    const [inviteRole, setInviteRole]     = useState<'viewer' | 'creator'>('creator');
    const [inviting, setInviting]         = useState(false);
    const [removingId, setRemovingId]     = useState<string | null>(null);
    const [rescindingId, setRescindingId] = useState<string | null>(null);
    const [resendingId, setResendingId]   = useState<string | null>(null);
    const [inviteFailure, setInviteFailure] = useState<{ email: string; message: string; resend: boolean } | null>(null);

    const isAdmin = details.role === 'admin';
    // Seats are bought by the owner alone — an admin out of seats has to ask
    const isOwner = currentUserId === details.owner_id;

    // Seat pre-purchase (plans/seat-prepurchase-oneshot.md): purchased =
    // subscription seats; used = creator/admin members (the owner is
    // synthesized into the list as admin); pending creator/admin
    // invitations reserve a seat; viewers are free.
    const purchasedSeats = details.seats ?? 0;
    const usedSeats      = details.members.filter(m => m.role === 'creator' || m.role === 'admin').length;
    const reservedSeats  = details.invitations.filter(i => i.role !== 'viewer').length;
    const availableSeats = Math.max(0, purchasedSeats - usedSeats - reservedSeats);
    const noSeatLeft     = availableSeats === 0;
    // Seats are gone and they still want a creator. Earlier this quietly
    // rewrote the role to viewer and sent it anyway, so an admin could invite
    // someone as a viewer while believing they'd invited a creator. The choice
    // now stands and the send is refused until THEY change it.
    const seatBlocked = noSeatLeft && inviteRole === 'creator';

    // Addresses the workspace already knows: a member can't be invited at all,
    // and a pending invitation is REPLACED by the server (delete + reinsert),
    // so re-sending the same role is really a resend — steer to that button
    // instead of silently issuing a second, identical invitation.
    const typedEmail     = inviteEmail.trim().toLowerCase();
    const existingMember = typedEmail ? details.members.find(m => m.email.toLowerCase() === typedEmail) : undefined;
    const existingInvite = typedEmail ? details.invitations.find(i => i.email.toLowerCase() === typedEmail) : undefined;
    // A pending invite for a DIFFERENT role is still worth sending — it swaps the role
    const duplicateInvite = existingInvite?.role === inviteRole;
    // Flagged on the address field only when the ADDRESS is the problem —
    // a seat shortage is about the role, so it must not redden the email
    const emailBlocked  = Boolean(existingMember) || duplicateInvite;
    const inviteBlocked = emailBlocked || seatBlocked;

    // Only say what the seat bar above can't — a routine invite needs no hint
    const inviteHint =
        existingMember  ? `${existingMember.email} is already a member of this workspace.`
      : duplicateInvite ? `${typedEmail} already has a pending ${inviteRole} invitation — use Resend below.`
      : existingInvite  ? `${typedEmail} is already invited as ${existingInvite.role} — sending replaces that invitation.`
      : seatBlocked     ? (isOwner
                            ? 'No creator seats left — add a seat above, or switch the role to Viewer.'
                            : 'No creator seats left — ask the workspace owner to add one, or switch the role to Viewer.')
      : inviteRole === 'viewer'
            ? 'Viewers are free — they can watch videos in this workspace but cannot create new ones.'
      : null;

    const inputClass = "px-3 py-2 text-sm bg-surface border border-border rounded-[var(--radius-interactive)] text-text-main placeholder:text-text-muted outline-none focus:border-primary transition-colors";

    // ── No active subscription — collaboration is a Pro feature ──────────────
    if (!hasTeamAccess) {
        return (
            <div className="w-full">
                <h3 className="text-sm font-bold text-text-highlighted">Members</h3>
                <p className="text-xs text-text-muted mt-1">
                    {isOwner
                        ? 'Adding team members is a Pro feature.'
                        : 'Adding team members is a Pro feature — the workspace owner buys the seats.'}
                </p>
            </div>
        );
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        const email = inviteEmail.trim().toLowerCase();
        if (!email || inviteBlocked) return;
        setInviting(true);
        try {
            const { data, error } = await invokeFunction('workspace-invite', {
                workspaceId: details.id,
                email,
                role: inviteRole,
            });
            if (error) throw error;
            setInviteEmail('');
            onInvitationSent({
                id: data.invitationId,
                email,
                role: inviteRole,
                invited_by: currentUserId ?? '',
                created_at: new Date().toISOString(),
            });
            addToast({ type: 'success', title: `Invitation sent to ${email}` });
        } catch (err) {
            const failure = err instanceof Error ? err : undefined;
            captureError(err, { flow: 'workspace', phase: 'invite', workspaceId: details.id, extra: { role: inviteRole } });
            trackWorkspaceInviteFailed({
                workspace_id: details.id,
                role: inviteRole,
                error: failure?.message || 'Unknown error',
                error_name: failure?.name,
                is_offline: !navigator.onLine,
            });
            setInviteFailure({
                email,
                message: await apiErrorMessage(err, 'Something went wrong while sending the invitation.'),
                resend: false,
            });
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
            setInviteFailure({
                email,
                message: await apiErrorMessage(err, 'Something went wrong while resending the invitation.'),
                resend: true,
            });
        } finally {
            setResendingId(null);
        }
    };

    // ── Full members UI ───────────────────────────────────────────────────────

    return (
        <div className="w-full flex flex-col gap-6">
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
                            aria-invalid={emailBlocked || undefined}
                            className={`${inputClass} flex-1 ${emailBlocked ? 'border-destructive' : ''}`}
                        />
                        <Dropdown<'creator' | 'viewer'>
                            options={[
                                {
                                    value: 'creator',
                                    label: 'Creator',
                                    disabled: noSeatLeft,
                                    suffix: noSeatLeft ? <span className="text-2xs text-text-muted">No seats</span> : undefined,
                                },
                                { value: 'viewer', label: 'Viewer' },
                            ]}
                            value={inviteRole}
                            onChange={setInviteRole}
                            ariaLabel="Invite role"
                            hideSuffixInTrigger
                            fullWidth={false}
                        />
                        <Button
                            type="submit"
                            variant="primary"
                            disabled={inviting || !typedEmail || inviteBlocked}
                        >
                            {inviting ? 'Sending…' : existingInvite && !duplicateInvite ? 'Update Invite' : 'Send Invite'}
                        </Button>
                    </form>
                    {inviteHint && (
                        <p
                            role="status"
                            className={`flex items-start gap-2 text-xs mt-3 px-3 py-2 rounded-[var(--radius-sm)] ${
                                inviteBlocked
                                    ? 'bg-destructive/10 border border-destructive/30 text-destructive'
                                    : 'bg-state-inactive text-text-main'
                            }`}
                        >
                            {inviteBlocked
                                ? <LuCircleAlert className="icon-sm shrink-0 mt-0.5" />
                                : <LuInfo className="icon-sm shrink-0 mt-0.5" />}
                            {inviteHint}
                        </p>
                    )}
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

            {inviteFailure && (
                <InviteFailedModal failure={inviteFailure} onClose={() => setInviteFailure(null)} />
            )}
        </div>
    );
}
