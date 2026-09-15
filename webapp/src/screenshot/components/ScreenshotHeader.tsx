/**
 * Screenshot editor header: logo, undo/redo, save status + name in the
 * centre, action buttons (export/share — supplied by the editor as
 * `children` in Steps 9–10) and the user menu on the right.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { LuRedo2, LuUndo2 } from 'react-icons/lu';
import { Button, LogoLink, StatusBadge } from '@shared/components';
import { ProjectNameField } from '../../editor/components/header/ProjectNameField';
import { UserMenu } from '../../components/UserMenu';
import { SupportModal } from '../../components/SupportModal';
import { useToast } from '../../components/Toast';
import { useSyncStatusStore } from '../../storage/syncStatusStore';
import { captureError } from '../../lib/sentry';
import { ScreenshotService } from '../screenshotService';
import { useScreenshotHistory, useScreenshotStore } from '../store/useScreenshotStore';
import { useScreenshotMetaStore } from '../store/useScreenshotMetaStore';
import { navigate } from '../../lib/navigate';

function SaveStatusBadge() {
    const status = useSyncStatusStore(s => s.status);
    if (status === 'syncing') return <StatusBadge>Saving…</StatusBadge>;
    if (status === 'error') return <StatusBadge variant="secondary">Save failed</StatusBadge>;
    return <StatusBadge>Saved</StatusBadge>;
}

export function ScreenshotHeader({ children }: { children?: ReactNode }) {
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const { addToast } = useToast();
    const name = useScreenshotStore(s => s.name);
    const setName = useScreenshotStore(s => s.setName);
    const meta = useScreenshotMetaStore(s => s.meta);
    const setMetaName = useScreenshotMetaStore(s => s.setName);
    const undo = useScreenshotHistory(s => s.undo);
    const redo = useScreenshotHistory(s => s.redo);
    const canUndo = useScreenshotHistory(s => s.pastStates.length > 0);
    const canRedo = useScreenshotHistory(s => s.futureStates.length > 0);

    const handleRename = useCallback((next: string) => {
        if (!meta) return;
        const previous = name;
        setName(next);
        setMetaName(next);
        ScreenshotService.renameScreenshot(meta.id, next).catch(err => {
            setName(previous);
            setMetaName(previous);
            captureError(err, { flow: 'screenshot_rename', extra: { screenshotId: meta.id } });
            addToast({ type: 'error', title: 'Failed to rename screenshot' });
        });
    }, [meta, name, setName, setMetaName, addToast]);

    return (
        <header className="h-14 shrink-0 px-3 flex items-center justify-between relative bg-surface border-b border-border select-none">
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    onClick={() => navigate('/')}
                    aria-label="Go to dashboard"
                    className="w-fit"
                >
                    <LogoLink imgClassName="h-7" />
                </Button>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-1">
                    <Button variant="ghost" icon={LuUndo2} onClick={() => undo()} disabled={!canUndo} aria-label="Undo" title="Undo (Cmd+Z)" />
                    <Button variant="ghost" icon={LuRedo2} onClick={() => redo()} disabled={!canRedo} aria-label="Redo" title="Redo (Cmd+Shift+Z)" />
                </div>
            </div>

            <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <SaveStatusBadge />
                <ProjectNameField
                    value={name}
                    onCommit={handleRename}
                    placeholder="Untitled"
                    ariaLabel="Screenshot name"
                    inputId="screenshot-name-input"
                />
            </div>

            <div className="flex items-center gap-2">
                {children}
                <div className="ml-1">
                    <UserMenu onOpenSupportModal={() => setIsSupportModalOpen(true)} />
                </div>
            </div>

            <SupportModal isOpen={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />
        </header>
    );
}
