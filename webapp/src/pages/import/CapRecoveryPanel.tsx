import { useEffect, useState } from 'react';
import { LuFolderInput, LuTrash2 } from 'react-icons/lu';
import { Button } from '@shared/components';
import { CloudProjectService } from '../../storage/cloudProjectService';
import { ScreenshotService } from '../../screenshot/screenshotService';
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
    /** Which cap was hit — decides the list, the copy and the delete target. */
    kind: 'project' | 'screenshot';
    /** From the 403 body; null if the server omitted it. */
    cap: number | null;
    workspaceId: string;
    /** Re-runs the import — the recording/screenshot stays in the bridge state. */
    onRetry: () => void;
}

/** The subset of a project / screenshot list row the panel renders. */
interface OwnedItem {
    id: string;
    name: string;
    thumbnail: string | null;
    createdAt: string;
    durationMs: number | null;
}

function formatDuration(ms: number | null): string | null {
    if (!ms) return null;
    const seconds = Math.round(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Copy per cap kind — the two caps are independent (plans/screenshots). */
const COPY = {
    project: {
        label: 'Project limit reached',
        noun: 'project',
        plural: 'projects',
        payload: 'recording',
        save: 'Save recording',
        deleteHeading: 'Delete a project',
    },
    screenshot: {
        label: 'Screenshot limit reached',
        noun: 'screenshot',
        plural: 'screenshots',
        payload: 'screenshot',
        save: 'Save screenshot',
        deleteHeading: 'Delete a screenshot',
    },
} as const;

/**
 * The at-cap recovery panel (billing revamp Step 4). Shown when
 * /project-create-v2 refuses with project_cap_reached (or
 * /screenshot-create with screenshot_cap_reached). Deleting items
 * updates the meter live but does NOT auto-retry — the primary CTA flips
 * to "Save recording" once a slot is free. Saving into another workspace
 * the caller can create in switches the default and retries immediately.
 */
export function CapRecoveryPanel({ kind, cap, workspaceId, onRetry }: CapRecoveryPanelProps) {
    const userId = useUserStore(s => s.userId);
    const { addToast } = useToast();
    const copy = COPY[kind];

    const [loading, setLoading] = useState(true);
    const [ownedItems, setOwnedItems] = useState<OwnedItem[]>([]);
    const [otherWorkspaces, setOtherWorkspaces] = useState<WorkspaceListItem[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    useEffect(() => {
        trackImportProjectCapModalViewed({ workspace_id: workspaceId });
    }, [workspaceId]);

    useEffect(() => {
        let cancelled = false;
        const onThumbnail = (id: string, thumbnailUrl: string) => {
            if (cancelled) return;
            setOwnedItems(prev => prev.map(p => (p.id === id ? { ...p, thumbnail: thumbnailUrl } : p)));
        };
        (async () => {
            const [items, wsList] = await Promise.all([
                kind === 'screenshot'
                    ? ScreenshotService.listScreenshots(workspaceId).catch(() => [])
                    : CloudProjectService.listProjects(workspaceId).catch(() => []),
                invokeFunction('workspace-list', {}).then(
                    ({ data }) => data?.workspaces ?? []).catch(() => []),
            ]);
            if (cancelled) return;
            const owned = items.filter(p => p.ownerId === userId && !p.deletedAt);
            setOwnedItems(owned.map(p => ({
                id: p.id,
                name: p.name,
                thumbnail: p.thumbnail,
                createdAt: p.createdAt,
                durationMs: 'durationMs' in p ? p.durationMs : null,
            })));
            // Only workspaces the caller can CREATE in — viewers can't import
            setOtherWorkspaces((wsList as WorkspaceListItem[]).filter(
                w => w.id !== workspaceId && (w.role === 'creator' || w.role === 'admin'),
            ));
            setLoading(false);
            if (kind === 'screenshot') {
                ScreenshotService.loadThumbnails(owned as Awaited<ReturnType<typeof ScreenshotService.listScreenshots>>, onThumbnail);
            } else {
                CloudProjectService.loadThumbnails(owned as Awaited<ReturnType<typeof CloudProjectService.listProjects>>, onThumbnail);
            }
        })();
        return () => { cancelled = true; };
    }, [workspaceId, userId, kind]);

    const handleDelete = async (id: string) => {
        trackDeleteProjectClicked({ project_id: id, workspace_id: workspaceId });
        setBusyId(id);
        try {
            if (kind === 'screenshot') await ScreenshotService.deleteScreenshot(id);
            else await CloudProjectService.deleteProject(id);
            // No auto-retry — the meter updates and "Save …" takes over
            setOwnedItems(prev => prev.filter(p => p.id !== id));
        } catch {
            addToast({ type: 'error', title: `Failed to delete ${copy.noun}` });
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

    const slotFree = !loading && cap !== null && ownedItems.length < cap;

    return (
        <div
            role="alert"
            aria-label={copy.label}
            // No card chrome of its own — it renders inside the import page's card
            className="mt-6 w-full text-left"
        >
            <p className="text-sm text-text-main">
                {cap !== null
                    ? `You've reached the Free plan's limit of ${cap} active ${copy.plural}.`
                    : `You've reached the Free plan's ${copy.noun} limit.`}{' '}
                Your {copy.payload} is safe — free up a slot below and save it.
            </p>

            {!loading && cap !== null && (
                <div className="mt-4">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-text-main">
                            {ownedItems.length} of {cap} {copy.plural} used
                        </span>
                    </div>
                    <div className="h-1.5 bg-state-inactive rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${
                                ownedItems.length >= cap ? 'bg-destructive' : 'bg-primary'
                            }`}
                            style={{ width: `${Math.min((ownedItems.length / cap) * 100, 100)}%` }}
                        />
                    </div>
                </div>
            )}

            <div className="mt-4">
                <p className="text-eyebrow mb-2">
                    {copy.deleteHeading}
                </p>
                {loading ? (
                    <p className="text-sm text-text-muted">Loading {copy.plural}...</p>
                ) : ownedItems.length === 0 ? (
                    <p className="text-sm text-text-muted">No {copy.plural} found in this workspace.</p>
                ) : (
                    <ul className="flex flex-col gap-1 max-h-60 overflow-y-auto scrollbar-thin pr-1">
                        {ownedItems.map(p => (
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
                                    <p className="text-xs text-text-muted">
                                        {timeAgo(p.createdAt)}
                                        {formatDuration(p.durationMs) ? ` · ${formatDuration(p.durationMs)}` : ''}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
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
                    <p className="text-eyebrow mb-2">
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
                            {copy.save}
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
                        <Button variant="ghost" onClick={onRetry}>
                            Try again
                        </Button>
                    </>
                )}
                <TrialExtendLink />
            </div>
        </div>
    );
}
