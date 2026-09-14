import { useCallback, useEffect, useRef, useState } from 'react';
import { LuLoader } from 'react-icons/lu';
import { Button, Modal } from '@shared/components';
import type { ProjectSettings } from '@shared/types';
import type { StoredProjectDefaults } from '@shared/api';
import { useProjectStore } from '../../../editor/stores/useProjectStore';
import { useMediaUrlStore } from '../../../storage/useMediaUrlStore';
import { UserDefaultsService } from '../../../storage/userDefaultsService';
import { resolveProjectDefaults, stripRecordingSpecificSettings } from '../../../core/projectDefaults';
import { useToast } from '../../../components/Toast';
import { captureError } from '../../../lib/sentry';
import {
    trackPersonalDefaultsReset,
    trackPersonalDefaultsSaved,
    trackPersonalSettingsPageLoaded,
} from '../../../analytics';
import { usePersonalDefaultsStore } from './usePersonalDefaultsStore';
import { useDefaultsPreviewStore } from '../../../editor/stores/useDefaultsPreviewStore';
import { DefaultsSettingsPanel } from './DefaultsSettingsPanel';
import { DefaultsPreview } from './DefaultsPreview';

type LoadState = 'loading' | 'ready' | 'error';

const CARD = 'bg-surface border border-border rounded-[var(--radius-lg)]';

/** Comparable form of a settings tree — the same shape that gets stored. */
const serialize = (settings: ProjectSettings) => JSON.stringify(stripRecordingSpecificSettings(settings));

/**
 * Personal settings — the user's default project settings
 * (plans/user-default-project-settings §3.6). Loads the stored defaults
 * (or the shipped factory) into the project store as a "defaults
 * template", lets the editor's settings panels edit it next to a live
 * preview, and saves explicitly. Rendered inside the dashboard layout.
 */
export function PersonalSettingsPage() {
    const { addToast } = useToast();
    const [loadState, setLoadState] = useState<LoadState>('loading');
    const [hasStored, setHasStored] = useState(false);
    const [baseline, setBaseline] = useState('');
    const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
    const [confirmReset, setConfirmReset] = useState(false);
    const lastStored = useRef<StoredProjectDefaults | null>(null);

    const templateMode = useProjectStore(s => s.templateMode);
    const settings = useProjectStore(s => s.project.settings);
    const loadDefaultsTemplate = useProjectStore(s => s.loadDefaultsTemplate);
    const unloadDefaultsTemplate = useProjectStore(s => s.unloadDefaultsTemplate);
    const setDirty = usePersonalDefaultsStore(s => s.setDirty);

    /** Put a stored blob (or null = shipped defaults) into the template and re-baseline. */
    const applyStored = useCallback((stored: StoredProjectDefaults | null) => {
        const resolved = resolveProjectDefaults(stored);
        loadDefaultsTemplate(resolved);
        setBaseline(serialize(resolved));
        setHasStored(stored !== null);
        lastStored.current = stored;
    }, [loadDefaultsTemplate]);

    const load = useCallback(async () => {
        setLoadState('loading');
        try {
            const stored = await UserDefaultsService.fetch();
            applyStored(stored);
            setLoadState('ready');
        } catch (err) {
            captureError(err, { flow: 'user_defaults', phase: 'page_load' });
            setLoadState('error');
        }
    }, [applyStored]);

    useEffect(() => {
        trackPersonalSettingsPageLoaded();
        void load();
        return () => {
            useDefaultsPreviewStore.getState().stop();
            unloadDefaultsTemplate();
            // blob URLs hydrated for custom backgrounds/music while editing
            useMediaUrlStore.getState().revokeAll();
            usePersonalDefaultsStore.getState().setDirty(false);
        };
        // mount/unmount only
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isDirty = loadState === 'ready' && templateMode && serialize(settings) !== baseline;

    useEffect(() => { setDirty(isDirty); }, [isDirty, setDirty]);

    useEffect(() => {
        if (!isDirty) return;
        const warn = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [isDirty]);

    const handleSave = async () => {
        setBusy('save');
        try {
            const stored = await UserDefaultsService.save(settings);
            lastStored.current = stored;
            setBaseline(serialize(settings));
            setHasStored(true);
            trackPersonalDefaultsSaved({ source: 'page' });
            addToast({ type: 'success', title: 'Defaults saved', message: 'New projects will start with these settings.' });
        } catch (err) {
            captureError(err, { flow: 'user_defaults', phase: 'save_from_page' });
            addToast({ type: 'error', title: 'Could not save defaults', message: 'Please try again.' });
        } finally {
            setBusy(null);
        }
    };

    const handleDiscard = () => applyStored(lastStored.current);

    const handleReset = async () => {
        setBusy('reset');
        try {
            await UserDefaultsService.clear();
            applyStored(null);
            trackPersonalDefaultsReset();
            addToast({ type: 'success', title: 'Back to Recordio defaults', message: 'New projects will use the built-in look.' });
            setConfirmReset(false);
        } catch (err) {
            captureError(err, { flow: 'user_defaults', phase: 'reset' });
            addToast({ type: 'error', title: 'Could not reset defaults', message: 'Please try again.' });
        } finally {
            setBusy(null);
        }
    };

    const ready = loadState === 'ready';
    const status = isDirty
        ? { label: 'Unsaved changes', className: 'bg-secondary/20 text-text-highlighted' }
        : hasStored
            ? { label: 'Custom defaults', className: 'bg-primary/10 text-primary' }
            : { label: 'Using Recordio defaults', className: 'bg-state-inactive text-text-muted' };

    return (
        <div className="flex flex-col flex-1 min-h-0 gap-4">
            {/* Page header + actions */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="heading-2">Personal settings</h1>
                        {ready && (
                            <span
                                className={`text-badge rounded-[var(--radius-sm)] px-2 py-1 ${status.className}`}
                                role="status"
                            >
                                {status.label}
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-text-muted mt-1">
                        Defaults for every new project you create. Existing projects aren’t affected.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => setConfirmReset(true)}
                        disabled={!ready || busy !== null || (!hasStored && !isDirty)}
                    >
                        Reset to Recordio defaults
                    </Button>
                    {isDirty && (
                        <Button variant="base" onClick={handleDiscard} disabled={busy !== null}>
                            Discard
                        </Button>
                    )}
                    <Button variant="primary" onClick={handleSave} disabled={!isDirty || busy !== null}>
                        {busy === 'save' ? 'Saving…' : 'Save defaults'}
                    </Button>
                </div>
            </div>

            {/* The editor-like surface: settings column + preview, framed as a card */}
            {loadState === 'loading' ? (
                <div className={`${CARD} flex items-center gap-2 text-text-muted text-sm p-6`}>
                    <LuLoader className="icon-sm animate-spin" /> Loading defaults…
                </div>
            ) : loadState === 'error' ? (
                <div className={`${CARD} p-6 flex flex-col items-start gap-3`}>
                    <p className="text-sm text-text-muted">Could not load your defaults.</p>
                    <Button variant="base" onClick={() => void load()}>Retry</Button>
                </div>
            ) : (
                <div className={`${CARD} flex flex-1 min-h-0 overflow-hidden`}>
                    <DefaultsSettingsPanel />
                    <DefaultsPreview />
                </div>
            )}

            <Modal
                isOpen={confirmReset}
                onClose={() => { if (busy === null) setConfirmReset(false); }}
                maxWidth="max-w-[460px]"
                ariaLabel="Reset to Recordio defaults"
            >
                <h2 className="heading-2 mb-2">Reset to Recordio defaults?</h2>
                <p className="text-sm text-text-main mb-6">
                    Your saved personal defaults will be removed and new projects will use the
                    built-in look. Existing projects don’t change.
                </p>
                <div className="flex justify-end gap-2">
                    <Button variant="base" onClick={() => setConfirmReset(false)} disabled={busy !== null}>
                        Keep mine
                    </Button>
                    <Button variant="destructive" onClick={handleReset} disabled={busy !== null}>
                        {busy === 'reset' ? 'Resetting…' : 'Reset'}
                    </Button>
                </div>
            </Modal>
        </div>
    );
}
