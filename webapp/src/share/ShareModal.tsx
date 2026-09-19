import { useEffect, useState } from 'react';
import { Modal, Button, Dropdown, Tooltip, type DropdownOption } from '@shared/components';
import { LuLink } from 'react-icons/lu';
import type { AccessRole, SharePolicy, WorkspaceMemberRow } from '@shared/api';
import { invokeFunction } from '../api/client';
import { useProjectMetaStore } from './useProjectMetaStore';
import { useUserStore } from '../auth/useUserStore';
import { useActivityStore, selectUploadTask } from '../activity/useActivityStore';
import { CloudProjectService } from '../storage/cloudProjectService';
import { useToast } from '../components/Toast';
import { captureError } from '../lib/sentry';
import { videoUrl } from '../lib/videoUrls';
import { copiedLinkToast } from './copyLinkToast';
import { trackPublishClicked, trackPublishFailed } from '../analytics';
import { Avatar, OwnerOnlyNote, ShareCreatorRow, SharePolicyControls } from './SharePolicyControls';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectName: string;
}

/**
 * Share settings (share-access model): visibility + workspace access
 * level + individual member grants. Only the owner can change settings —
 * others get a read-only view with Copy link. State lives in
 * useProjectMetaStore (populated by the editor's project load or the
 * dashboard's card menu), updated optimistically here and reverted on
 * API failure.
 */
export function ShareModal({ isOpen, onClose, projectName }: ShareModalProps) {
    const meta = useProjectMetaStore(s => s.meta);
    const setShareSettings = useProjectMetaStore(s => s.setShareSettings);
    const setEditors = useProjectMetaStore(s => s.setEditors);
    const userId = useUserStore(s => s.userId);
    const { addToast } = useToast();
    const isSyncingMedia = useActivityStore(s => (meta ? selectUploadTask(meta.id)(s)?.status === 'active' : false));

    const [members, setMembers] = useState<WorkspaceMemberRow[]>([]);

    // Workspace members feed the invite picker
    const workspaceId = meta?.workspaceId;
    useEffect(() => {
        if (!isOpen || !workspaceId) return;
        let cancelled = false;
        invokeFunction('workspace-get', { workspaceId }).then(({ data, error }) => {
            if (!cancelled && !error && data) setMembers(data.members);
        });
        return () => { cancelled = true; };
    }, [isOpen, workspaceId]);

    if (!meta) return null;
    const isOwner = meta.ownerId === userId;
    const canEdit = isOwner
        || meta.editors.some(e => e.user_id === userId && e.role === 'edit')
        || (meta.sharePolicy !== 'private' && meta.workspaceAccess === 'edit');

    /** Grants the server's override rule would delete under the given settings. */
    const grantsRemovedBy = (sharePolicy: SharePolicy, workspaceAccess: AccessRole) =>
        sharePolicy === 'private'
            ? []
            : meta.editors.filter(e => workspaceAccess === 'edit' || e.role === 'view');

    /** Publish/refresh the shared Mux video for the current edit version (idempotent server-side). */
    const triggerMuxUpdate = () => {
        if (isSyncingMedia || !canEdit) return;
        // In the editor the service tracks the live version; from the
        // dashboard fall back to the version project-get reported
        const cloudVersion = CloudProjectService.getCloudVersion(meta.id) ?? meta.cloudVersion;
        void invokeFunction<{ status: string; muxVideoId: string }>('mux-video-create', {
            projectId: meta.id, cloudVersion,
        }).then(({ error }) => {
            if (error) captureError(error, { flow: 'publish', phase: 'mux_create', projectId: meta.id });
        });
    };

    const applyShareSettings = async (sharePolicy: SharePolicy, workspaceAccess: AccessRole) => {
        if (sharePolicy === meta.sharePolicy && workspaceAccess === meta.workspaceAccess) return;
        const prev = meta;
        const wasPrivate = meta.sharePolicy === 'private';
        const removed = grantsRemovedBy(sharePolicy, workspaceAccess);
        setShareSettings(sharePolicy, workspaceAccess);
        setEditors(meta.editors.filter(e => !removed.some(r => r.user_id === e.user_id)));
        trackPublishClicked(meta.id);

        const { error } = await invokeFunction('project-share', {
            projectId: meta.id, sharePolicy, workspaceAccess,
        });
        if (error) {
            setShareSettings(prev.sharePolicy, prev.workspaceAccess);
            setEditors(prev.editors);
            trackPublishFailed({
                project_id: meta.id,
                error: error.message || 'Unknown error',
                error_name: error.name,
                is_offline: !navigator.onLine,
            });
            addToast({ type: 'error', title: 'Failed to update share settings' });
            return;
        }
        if (wasPrivate && sharePolicy !== 'private') triggerMuxUpdate();
    };

    const setEditorGrant = async (targetUserId: string, role: AccessRole) => {
        const { data, error } = await invokeFunction('project-editor-set', {
            projectId: meta.id, userId: targetUserId, role,
        });
        if (error || !data) {
            addToast({ type: 'error', title: 'Failed to update access' });
            return;
        }
        setEditors(data.editors);
    };

    const removeEditor = async (targetUserId: string) => {
        const { data, error } = await invokeFunction('project-editor-remove', {
            projectId: meta.id, userId: targetUserId,
        });
        if (error || !data) {
            addToast({ type: 'error', title: 'Failed to remove access' });
            return;
        }
        setEditors(data.editors);
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(videoUrl(meta.slug));
            addToast(copiedLinkToast(meta.sharePolicy));
        } catch {
            addToast({ type: 'error', title: 'Failed to copy link' });
            return;
        }
        // Copying the link is the "I'm sharing this now" moment — make
        // sure the published video matches the latest edits
        triggerMuxUpdate();
    };

    // Workspace-wide access makes parts of individual sharing moot:
    // with edit there is nobody left to invite; with view, per-person
    // 'view' grants are redundant (everyone already views).
    const workspaceHasView = meta.sharePolicy !== 'private';
    const workspaceHasEdit = workspaceHasView && meta.workspaceAccess === 'edit';

    const candidateOptions: DropdownOption<string>[] = members
        .filter(m => m.user_id !== meta.ownerId
            && !meta.editors.some(e => e.user_id === m.user_id)
            // Under workspace-view, viewer-role members have nothing left
            // to gain: view is redundant, edit is seat-blocked server-side
            && !(workspaceHasView && m.role === 'viewer'))
        .map(m => ({
            value: m.user_id,
            label: m.name ?? m.email,
            suffix: <span className="text-xs text-text-muted">{m.email}</span>,
        }));

    // 'remove' rides along in the role dropdown as a red destructive action
    const editorRoleOptions: DropdownOption<AccessRole | 'remove'>[] = [
        { value: 'view', label: 'Can view', disabled: workspaceHasView },
        { value: 'edit', label: 'Can edit' },
        { value: 'remove', label: 'Remove', destructive: true },
    ];

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[480px]" ariaLabel="Share project">
            <div className="flex flex-col gap-4">
                <h2 className="heading-2 truncate">Share &ldquo;{projectName}&rdquo;</h2>

                {isOwner && (
                    <div className="flex flex-col gap-1">
                        <span className="text-sm text-text-highlighted">Invite people</span>
                        {workspaceHasEdit ? (
                            <Tooltip text="Everyone in the workspace already has edit access">
                                {/* pointer-events-none: disabled buttons swallow hover,
                                    so let the tooltip wrapper receive it */}
                                <Dropdown
                                    options={candidateOptions}
                                    value=""
                                    onChange={() => {}}
                                    placeholder="Add workspace members..."
                                    ariaLabel="Invite people"
                                    disabled
                                    className="pointer-events-none"
                                />
                            </Tooltip>
                        ) : (
                            <Dropdown
                                options={candidateOptions}
                                value=""
                                onChange={uid => void setEditorGrant(uid, workspaceHasView ? 'edit' : 'view')}
                                placeholder="Add workspace members..."
                                ariaLabel="Invite people"
                                disabled={candidateOptions.length === 0}
                            />
                        )}
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <span className="text-sm text-text-highlighted">Who has access</span>

                    <SharePolicyControls
                        sharePolicy={meta.sharePolicy}
                        workspaceAccess={meta.workspaceAccess}
                        isOwner={isOwner}
                        onChange={(p, a) => void applyShareSettings(p, a)}
                        privateSubtitle="Only you and people added below can open it"
                    />

                    {/* Creator */}
                    <ShareCreatorRow name={meta.ownerName} email={meta.ownerEmail} isViewer={isOwner} />

                    {/* Individual grants */}
                    {meta.editors.map(e => (
                        <div key={e.user_id} className="flex items-center gap-3 py-1.5">
                            <Avatar name={e.name ?? e.email} />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-text-main truncate">
                                    {e.name ?? e.email}{e.user_id === userId ? ' (you)' : ''}
                                </p>
                                <p className="text-label truncate">{e.email}</p>
                            </div>
                            <Dropdown
                                options={editorRoleOptions}
                                value={e.role}
                                onChange={v => (v === 'remove'
                                    ? void removeEditor(e.user_id)
                                    : void setEditorGrant(e.user_id, v))}
                                fullWidth={false}
                                ariaLabel={`Access for ${e.email}`}
                                disabled={!isOwner}
                            />
                        </div>
                    ))}

                    {!isOwner && <OwnerOnlyNote />}
                </div>

                <Button variant="primary" fullWidth icon={LuLink} onClick={() => void handleCopyLink()}>
                    Copy link
                </Button>
            </div>
        </Modal>
    );
}
