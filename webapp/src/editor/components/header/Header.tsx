import { useState, useEffect, useRef } from 'react';
import { useProjectStore, useProjectData, useProjectName, useProjectHistory } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { LuUndo2, LuRedo2 } from 'react-icons/lu';

import { MdOutlineBugReport } from 'react-icons/md';
import { TbFolder } from 'react-icons/tb';

import { AuthModal } from './AuthModal';
import { SupportModal } from '../../../components/SupportModal';
import { navigate } from '../../../navigate';
import { UserMenu } from '../../../components/UserMenu';
import { UpgradeModal } from './UpgradeModal';
import { useUserStore } from '../../stores/useUserStore';
import { CloudProjectService } from '../../../storage/cloudProjectService';
import { useSyncStatusStore } from '../../../storage/syncStatusStore';

import { TbCloudUpload } from 'react-icons/tb';
import { LogoLink, Dropdown, Button, ProBadge, ThemeToggle, Tooltip, type DropdownOption } from '@shared/components';
import { ASPECT_RATIO_PRESETS, findPreset, type AspectRatioPreset } from '../../../core/aspectRatio';
import { useToast } from '../Toast';

const aspectRatioOptions: DropdownOption<AspectRatioPreset>[] = ASPECT_RATIO_PRESETS.map(preset => ({
    value: preset,
    label: preset.label,
    suffix: preset.orientation ? <span className="text-text-muted text-xs">{preset.orientation}</span> : undefined,
}));

function SyncIndicator() {
    const pendingMediaUploads = useSyncStatusStore(s => s.pendingMediaUploads);

    if (pendingMediaUploads <= 0) return null;

    return (
        <Tooltip text="Syncing to cloud...">
            <div className="flex items-center">
                <TbCloudUpload className="icon-md text-primary animate-pulse" />
            </div>
        </Tooltip>
    );
}

export const Header = () => {
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const { isAuthenticated, hasProAccess } = useUserStore();

    const { addToast } = useToast();

    const project = useProjectData();
    const projectName = useProjectName();
    const updateProjectName = useProjectStore(s => s.updateProjectName);
    const [localName, setLocalName] = useState(projectName);
    const localNameRef = useRef(localName);
    localNameRef.current = localName;

    // Sync local state when store name changes externally (e.g. project load)
    useEffect(() => { setLocalName(projectName); }, [projectName]);

    const outputSize = useProjectStore(s => s.project.settings.outputSize);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const resetZooms = useProjectStore(s => s.resetZooms);
    const resetSpotlights = useProjectStore(s => s.resetSpotlights);
    const currentPreset = findPreset(outputSize);

    const handleAspectRatioChange = (preset: AspectRatioPreset) => {
        updateSettings({ outputSize: { width: preset.width, height: preset.height } });
        resetZooms();
        resetSpotlights();

        const store = useProjectStore.getState().project.timeline;
        const hasZooms = store.zoomSegments.length > 0;
        const hasSpotlights = store.spotlightSegments.length > 0;
        if (hasZooms || hasSpotlights) {
            const parts = [hasZooms && 'zooms', hasSpotlights && 'spotlights'].filter(Boolean);
            addToast({ type: 'info', title: 'Recalculated', message: `Auto ${parts.join(' & ')} updated for new aspect ratio` });
        }
    };
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const pastStates = useProjectHistory(state => state.pastStates);
    const futureStates = useProjectHistory(state => state.futureStates);

    const handleGoToDashboard = async () => {
        const { userId, isPro } = useUserStore.getState();
        if (userId) {
            const { project: proj, userEvents } = useProjectStore.getState();
            const fullProject = { ...proj, userEvents };
            await CloudProjectService.saveProject(fullProject, userId, isPro);

            if (useSyncStatusStore.getState().conflict) {
                useSyncStatusStore.getState().setPendingNavigation('/');
                return;
            }
        }
        navigate('/');
    };



    return (
        <div id="editor-header" className="bg-surface border-b border-border flex flex-col shrink-0 z-[var(--z-index-navbar)] select-none">
            {/* Top Row: Main Controls */}
            <div className="h-12 flex items-center px-4 justify-between relative w-full">
                <div className="flex items-center gap-4">
                    <LogoLink className="mr-2" imgClassName="h-7" onClick={(e) => { e.preventDefault(); handleGoToDashboard(); }} />
                    {hasProAccess() && (
                        <ProBadge className="-ml-3" />
                    )}
                    <div className="h-4 w-[1px] bg-border mx-2"></div>

                    <div className="flex items-center gap-1">
                        <Button
                            variant="icon"
                            icon={LuUndo2}
                            onClick={() => undo()}
                            disabled={pastStates.length === 0}
                            title="Undo (Cmd+Z)"
                        />
                        <Button
                            variant="icon"
                            icon={LuRedo2}
                            onClick={() => redo()}
                            disabled={futureStates.length === 0}
                            title="Redo (Cmd+Shift+Z)"
                        />
                        {true && <span className="text-[10px] text-text-muted ml-1 tabular-nums">
                            {pastStates.length}/{pastStates.length + futureStates.length}
                        </span>}
                    </div>

                    {import.meta.env.MODE !== 'production' && (
                        <>
                            <div className="h-4 w-[1px] bg-border mx-2"></div>

                            {<Button
                                variant="ghost"
                                size="sm"
                                onClick={() => useUIStore.getState().toggleDebugBar()}
                                title="Toggle Debug Bar"
                                className="px-2 py-1 h-auto"
                            >
                                Debug
                            </Button>}
                        </>
                    )}
                </div>

                {/* Project Name + Aspect Ratio + Share Link (Centered) */}
                <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    <SyncIndicator />
                    <input
                        id="project-name-input"
                        type="text"
                        value={localName}
                        onChange={(e) => setLocalName(e.target.value)}
                        onBlur={() => {
                            if (localNameRef.current !== projectName) {
                                updateProjectName(localNameRef.current);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        maxLength={40}
                        className="h-9 bg-state-inactive text-text-main text-sm text-center border border-border focus:text-text-highlighted hover:bg-state-hover hover:border-border-highlighted focus:bg-state-hover focus:border-border-highlighted rounded-[var(--radius-interactive)] px-2 transition-colors placeholder-text-main w-[240px] focus-ring"
                        placeholder="Untitled Project"
                    />
                    <Dropdown
                        options={aspectRatioOptions}
                        value={currentPreset}
                        onChange={handleAspectRatioChange}
                        fullWidth={false}
                        buttonClassName="px-2 text-xs"
                        hideSuffixInTrigger
                    />
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                        <Button variant="icon" icon={TbFolder} onClick={handleGoToDashboard} title="Dashboard" />
                        <Button variant="icon" icon={MdOutlineBugReport} onClick={() => setIsSupportModalOpen(true)} title="Report a Bug" />
                        <ThemeToggle />
                    </div>
                    {isAuthenticated ? (
                        <UserMenu onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)} />
                    ) : (
                        <Button variant="ghost" onClick={() => setIsAuthModalOpen(true)} title="Sign in to unlock Pro features">
                            Sign In
                        </Button>
                    )}
                </div>
            </div>

            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
                onAuthSuccess={() => { }}
            />
            <UpgradeModal
                isOpen={isUpgradeModalOpen}
                onClose={() => setIsUpgradeModalOpen(false)}
                onSignInRequest={() => setIsAuthModalOpen(true)}
            />
            <SupportModal isOpen={isSupportModalOpen} onClose={() => setIsSupportModalOpen(false)} />
        </div>
    );
};

