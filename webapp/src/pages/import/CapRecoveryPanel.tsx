import { useEffect, useState } from 'react';
import { LuTrash2, LuFolderInput } from 'react-icons/lu';
import { Button } from '@shared/components';
import { CloudProjectService, type ProjectListItem } from '../../storage/cloudProjectService';
import { invokeFunction } from '../../api/client';
import { switchWorkspace } from '../../workspace/switchWorkspace';
import { useUserStore } from '../../auth/useUserStore';
import { useToast } from '../../components/Toast';
import { TrialExtendLink } from '../../billing/TrialExtendLink';
import { timeAgo } from '../dashboard/timeAgo';
import {
    trackDeleteProjectClicked,
    trackImportProjectCapModalViewed,
    trackSaveToWorkspaceClicked,
    trackUpgradeToProClicked,
} from '../../analytics';
import type { WorkspaceListItem } from '../../workspace/useWorkspaceStore';

interface CapRecoveryPanelProps {
    /** From the 403 body; null if the server omitted it. */
    cap: number | null;
    workspaceId: string;
    /** Re-runs the import — the recording stays in the bridge state. */
    onRetry: () => void;
}

function formatDuration(ms: number | null): string | null {
    if (!ms) return null;
    const seconds = Math.round(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * The at-cap recovery panel (billing revamp Step 4). Shown when
 * /project-create-v2 refuses with project_cap_reached. Deleting projects
 * updates the meter live but does NOT auto-retry — the primary CTA flips
 * to "Save recording" once a slot is free. Saving into another workspace
 * the caller can create in switches the default and retries immediately.
 */
export function CapRecoveryPanel({ cap, workspaceId, onRetry }: CapRecoveryPanelProps) {
    const userId = useUserStore(s => s.userId);
    const { addToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [ownedProjects, setOwnedProjects] = useState<ProjectListItem[]>([]);
    const [otherWorkspaces, setOtherWorkspaces] = useState<WorkspaceListItem[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    useEffect(() => {
        trackImportProjectCapModalViewed({ workspace_id: workspaceId });
    }, [workspaceId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [projects, wsList] = await Promise.all([
                CloudProjectService.listProjects(workspaceId).catch(() => []),
                invokeFunction('workspace-list', {}).then(
                    ({ data }) => data?.workspaces ?? []).catch(() => []),
            ]);
            if (cancelled) return;
            const owned = projects.filter(p => p.ownerId === userId && !p.deletedAt);
            setOwnedProjects(owned);
            // Only workspaces the caller can CREATE in — viewers can't import
            setOtherWorkspaces((wsList as WorkspaceListItem[]).filter(
                w => w.id !== workspaceId && (w.role === 'creator' || w.role === 'admin'),
            ));
            setLoading(false);
            CloudProjectService.loadThumbnails(owned, (projectId, thumbnailUrl) => {
                if (cancelled) return;
                setOwnedProjects(prev => prev.map(p =>
                    p.id === projectId ? { ...p, thumbnail: thumbnailUrl } : p,
                ));
            });
        })();
        return () => { cancelled = true; };
    }, [workspaceId, userId]);

    const handleDelete = async (projectId: string) => {
        trackDeleteProjectClicked({ project_id: projectId, workspace_id: workspaceId });
        setBusyId(projectId);
        try {
            await CloudProjectService.deleteProject(projectId);
            // No auto-retry — the meter updates and "Save recording" takes over
            setOwnedProjects(prev => prev.filter(p => p.id !== projectId));
        } catch {
            addToast({ type: 'error', title: 'Failed to delete project' });
        } finally {
            setBusyId(null);
        }
    };

    const handleSwitch = async (ws: WorkspaceListItem) => {
        trackSaveToWorkspaceClicked({ workspace_id: ws.id });
        setBusyId(ws.id);
        try {
            await switchWorkspace(ws, userId);
            onRetry();
        } catch {
            setBusyId(null);
            addToast({ type: 'error', title: 'Failed to switch workspace' });
        }
    };

    const handleUpgrade = () => {
        trackUpgradeToProClicked({ workspace_id: workspaceId });
        // New tab — this page still holds the recording
        window.open('/workspace/settings/billing', '_blank');
    };

    const slotFree = !loading && cap !== null && ownedProjects.length < cap;

    return (
        <div
            role="alert"
            aria-label="Project limit reached"
            // No card chrome of its own — it renders inside the import page's card
            className="mt-6 w-full text-left"
        >
            <p className="text-sm text-text-main">
                {cap !== null
                    ? `You've reached the Free plan's limit of ${cap} active projects.`
                    : "You've reached the Free plan's project limit."}{' '}
                Your recording is safe — free up a slot below and save it.
            </p>

            {!loading && cap !== null && (
                <div className="mt-4">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-text-main">
                            {ownedProjects.length} of {cap} projects used
                        </span>
                    </div>
                    <div className="h-1.5 bg-state-inactive rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${
                                ownedProjects.length >= cap ? 'bg-destructive' : 'bg-primary'
                            }`}
                            style={{ width: `${Math.min((ownedProjects.length / cap) * 100, 100)}%` }}
                        />
                    </div>
                </div>
            )}

            <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted mb-2">
                    Delete a project
                </p>
                {loading ? (
                    <p className="text-sm text-text-muted">Loading projects...</p>
                ) : ownedProjects.length === 0 ? (
                    <p className="text-sm text-text-muted">No projects found in this workspace.</p>
                ) : (
                    <ul className="flex flex-col gap-1 max-h-60 overflow-y-auto scrollbar-thin pr-1">
                        {ownedProjects.map(p => (
                            <li
                                key={p.id}
                                className="flex items-center gap-3 px-2 py-1.5 rounded-[var(--radius-md)] bg-surface border border-border"
                            >
                                <div className="w-16 h-10 shrink-0 rounded-[var(--radius-sm)] bg-state-inactive overflow-hidden">
                                    {p.thumbnail && (
                                        <img
                                            src={p.thumbnail}
                                            alt=""
                                            className="w-full h-full object-cover"
                                        />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-text-main truncate">{p.name}</p>
                                    <p className="text-[11px] text-text-muted">
                                        {timeAgo(p.createdAt)}
                                        {formatDuration(p.durationMs) ? ` · ${formatDuration(p.durationMs)}` : ''}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={LuTrash2}
                                    onClick={() => handleDelete(p.id)}
                                    disabled={busyId !== null}
                                    aria-label={`Delete ${p.name}`}
                                >
                                    {busyId === p.id ? 'Deleting…' : 'Delete'}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {otherWorkspaces.length > 0 && (
                <div className="mt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted mb-2">
                        Or save to a different workspace
                    </p>
                    <ul className="flex flex-col gap-1">
                        {otherWorkspaces.map(ws => (
                            <li
                                key={ws.id}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-md)] bg-surface border border-border"
                            >
                                <span className="flex-1 min-w-0 text-sm text-text-main truncate">
                                    {ws.name}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={LuFolderInput}
                                    onClick={() => handleSwitch(ws)}
                                    disabled={busyId !== null}
                                >
                                    {busyId === ws.id ? 'Saving…' : 'Save here'}
                                </Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="mt-5 flex flex-col items-center gap-2">
                {slotFree ? (
                    <>
                        <Button variant="primary" fullWidth onClick={onRetry}>
                            Save recording
                        </Button>
                        <Button fullWidth onClick={handleUpgrade}>
                            Upgrade to Pro
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="primary" fullWidth onClick={handleUpgrade}>
                            Upgrade to Pro
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onRetry}>
                            Try again
                        </Button>
                    </>
                )}
                <TrialExtendLink />
            </div>
        </div>
    );
}
