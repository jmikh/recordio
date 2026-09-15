/**
 * Presentational pieces of the share dialog (share-access model):
 * visibility + workspace-access rows, the creator row and the owner-only
 * note. Shared by the video ShareModal (which adds invite/member grants
 * and Mux publishing) and the ScreenshotShareModal (plans/screenshots).
 */
import { Dropdown, type DropdownOption } from '@shared/components';
import { LuGlobe, LuLock, LuUsers } from 'react-icons/lu';
import type { AccessRole, SharePolicy } from '@shared/api';

export const POLICY_OPTIONS: DropdownOption<SharePolicy>[] = [
    { value: 'private', label: 'Private (only me)', icon: <LuLock className="icon-sm" /> },
    { value: 'workspace', label: 'Everyone in workspace', icon: <LuUsers className="icon-sm" /> },
    { value: 'public', label: 'Anyone with the link', icon: <LuGlobe className="icon-sm" /> },
];

export const ACCESS_OPTIONS: DropdownOption<AccessRole>[] = [
    { value: 'view', label: 'Can view' },
    { value: 'edit', label: 'Can edit' },
];

export function Avatar({ name }: { name: string }) {
    return (
        <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-bold shrink-0">
            {name.slice(0, 2).toUpperCase()}
        </div>
    );
}

interface SharePolicyControlsProps {
    sharePolicy: SharePolicy;
    workspaceAccess: AccessRole;
    /** Only the owner can change settings — others see the dropdowns disabled */
    isOwner: boolean;
    onChange: (sharePolicy: SharePolicy, workspaceAccess: AccessRole) => void;
    /** Subtitle while private (the video dialog mentions invited people) */
    privateSubtitle?: string;
}

/** Visibility dropdown (+ subtitle) and, when not private, the workspace access level row. */
export function SharePolicyControls({
    sharePolicy, workspaceAccess, isOwner, onChange,
    privateSubtitle = 'Only you can open it',
}: SharePolicyControlsProps) {
    const policySubtitle = sharePolicy === 'public'
        ? 'Published to web — anyone with the link can view'
        : sharePolicy === 'workspace'
            ? `Workspace members can ${workspaceAccess === 'edit' ? 'edit' : 'view'}`
            : privateSubtitle;

    return (
        <>
            {/* Visibility */}
            <div className="flex items-center gap-3 py-1.5">
                <div className="w-8 h-8 rounded-full bg-state-inactive flex items-center justify-center text-text-muted shrink-0">
                    {sharePolicy === 'public'
                        ? <LuGlobe className="icon-md" />
                        : sharePolicy === 'workspace'
                            ? <LuUsers className="icon-md" />
                            : <LuLock className="icon-md" />}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <Dropdown
                        options={POLICY_OPTIONS}
                        value={sharePolicy}
                        onChange={p => onChange(p, workspaceAccess)}
                        ariaLabel="Visibility"
                        disabled={!isOwner}
                    />
                    <p className="text-label">{policySubtitle}</p>
                </div>
            </div>

            {/* Workspace access level */}
            {sharePolicy !== 'private' && (
                <div className="flex items-center gap-3 py-1.5">
                    <div className="w-8 h-8 rounded-full bg-state-inactive flex items-center justify-center text-text-muted shrink-0">
                        <LuUsers className="icon-md" />
                    </div>
                    <p className="flex-1 min-w-0 text-sm text-text-main truncate">Everyone in workspace</p>
                    <Dropdown
                        options={ACCESS_OPTIONS}
                        value={workspaceAccess}
                        onChange={a => onChange(sharePolicy, a)}
                        fullWidth={false}
                        ariaLabel="Workspace access"
                        disabled={!isOwner}
                    />
                </div>
            )}
        </>
    );
}

interface ShareCreatorRowProps {
    name: string | null;
    email: string;
    isViewer: boolean;
}

/** The "Creator" line: avatar, name (+ "(you)"), email. */
export function ShareCreatorRow({ name, email, isViewer }: ShareCreatorRowProps) {
    return (
        <div className="flex items-center gap-3 py-1.5">
            <Avatar name={name ?? email} />
            <div className="flex-1 min-w-0">
                <p className="text-sm text-text-main truncate">
                    {name ?? email}{isViewer ? ' (you)' : ''}
                </p>
                <p className="text-label truncate">{email}</p>
            </div>
            <span className="text-xs text-text-muted">Creator</span>
        </div>
    );
}

export function OwnerOnlyNote() {
    return <p className="text-label">Only the owner can change share settings.</p>;
}
