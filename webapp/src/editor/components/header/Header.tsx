import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore, useProjectData, useProjectHistory } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { FaUndo, FaRedo } from 'react-icons/fa';
import { MdDarkMode, MdLightMode } from 'react-icons/md';
import { BiSupport } from 'react-icons/bi';
import { TbLink } from 'react-icons/tb';

import { AuthModal } from './AuthModal';
import { SupportModal } from '../../../components/SupportModal';
import { UserMenu } from '../../../components/UserMenu';
import { UpgradeModal } from './UpgradeModal';
import { useUserStore } from '../../stores/useUserStore';
import { useThemeStore } from '../../../stores/useThemeStore';
import { LogoLink, Dropdown, type DropdownOption } from '@shared/components';
import { ASPECT_RATIO_PRESETS, findPreset, type AspectRatioPreset } from '../../../core/aspectRatio';
import { ShareService, type SharedVideo } from '../../services/ShareService';
import { useToast } from '../Toast';

/** Format a date as a relative time string, e.g. "2 hours ago" */
function timeAgo(dateStr: string): string {
    const ms = Date.now() - new Date(dateStr).getTime();
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    return `${days}d ago`;
}

const aspectRatioOptions: DropdownOption<AspectRatioPreset>[] = ASPECT_RATIO_PRESETS.map(preset => ({
    value: preset,
    label: preset.label,
    suffix: preset.orientation ? <span className="text-text-muted text-xs">{preset.orientation}</span> : undefined,
}));

export const Header = () => {
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const { isAuthenticated, hasProAccess } = useUserStore();
    const { theme, setTheme } = useThemeStore();
    const { addToast } = useToast();

    const project = useProjectData();
    const updateProjectName = useProjectStore(s => s.updateProjectName);
    const outputSize = useProjectStore(s => s.project.settings.outputSize);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const currentPreset = findPreset(outputSize);

    const handleAspectRatioChange = (preset: AspectRatioPreset) => {
        updateSettings({ outputSize: { width: preset.width, height: preset.height } });
    };
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const pastStates = useProjectHistory(state => state.pastStates);
    const futureStates = useProjectHistory(state => state.futureStates);

    // Share link state
    const [existingShare, setExistingShare] = useState<SharedVideo | null>(null);

    useEffect(() => {
        if (isAuthenticated && project?.id) {
            ShareService.getShareForProject(project.id).then(setExistingShare);
        }
    }, [isAuthenticated, project?.id]);

    // Listen for share updates from ExportSettings via a custom event
    useEffect(() => {
        const handler = () => {
            if (project?.id) {
                ShareService.getShareForProject(project.id).then(setExistingShare);
            }
        };
        window.addEventListener('share-updated', handler);
        return () => window.removeEventListener('share-updated', handler);
    }, [project?.id]);

    const copyShareLink = () => {
        if (!existingShare) return;
        const url = ShareService.getShareUrl(existingShare.id);
        navigator.clipboard.writeText(url);
        addToast({ type: 'success', title: 'Link Copied', message: url });
    };

    return (
        <div id="editor-header" className="bg-surface border-b border-border flex flex-col shrink-0 z-[var(--z-index-navbar)] select-none" style={{ boxShadow: 'var(--shadow-panel)' }}>
            {/* Top Row: Main Controls */}
            <div className="h-12 flex items-center px-4 justify-between relative w-full">
                <div className="flex items-center gap-4">
                    <LogoLink className="mr-2" imgClassName="h-7" />
                    {hasProAccess() && (
                        <span className="bg-primary text-text-on-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none uppercase -ml-3">Pro</span>
                    )}
                    <div className="h-4 w-[1px] bg-border mx-2"></div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => undo()}
                            disabled={pastStates.length === 0}
                            title="Undo (Cmd+Z)"
                            className="interactive-ghost flex items-center justify-center p-1.5 h-auto"
                        >
                            <FaUndo size={14} />
                        </button>
                        <button
                            onClick={() => redo()}
                            disabled={futureStates.length === 0}
                            title="Redo (Cmd+Shift+Z)"
                            className="interactive-ghost flex items-center justify-center p-1.5 h-auto"
                        >
                            <FaRedo size={14} />
                        </button>
                        {<span className="text-[10px] text-text-muted ml-1 tabular-nums">
                            {pastStates.length}/{pastStates.length + futureStates.length}
                        </span>}
                    </div>

                    {import.meta.env.MODE !== 'production' && false && (
                        <>
                            <div className="h-4 w-[1px] bg-border mx-2"></div>

                            {<button
                                onClick={() => useUIStore.getState().toggleDebugBar()}
                                title="Toggle Debug Bar"
                                className="interactive-ghost px-2 py-1 h-auto text-[10px]"
                            >
                                Debug
                            </button>}
                        </>
                    )}
                </div>

                {/* Project Name + Aspect Ratio + Share Link (Centered) */}
                <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    <input
                        id="project-name-input"
                        type="text"
                        value={project.name}
                        onChange={(e) => updateProjectName(e.target.value)}
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
                    {existingShare && (
                        <ShareLinkButton
                            onClick={copyShareLink}
                            snapshotDate={existingShare.updated_at}
                        />
                    )}
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                        <button onClick={() => setIsSupportModalOpen(true)} title="Contact Support" className="interactive-ghost flex items-center justify-center p-1.5 h-auto">
                            <BiSupport size={18} />
                        </button>
                        <button
                            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                            className="interactive-ghost flex items-center justify-center p-1.5 h-auto"
                        >
                            {theme === 'dark' ? <MdLightMode size={18} /> : <MdDarkMode size={18} />}
                        </button>
                    </div>
                    {isAuthenticated ? (
                        <UserMenu onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)} />
                    ) : (
                        <button onClick={() => setIsAuthModalOpen(true)} title="Sign in to unlock Pro features" className="interactive-ghost flex items-center justify-center gap-2">
                            Sign In
                        </button>
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

/** Small link icon with a two-line hover tooltip */
function ShareLinkButton({ onClick, snapshotDate }: { onClick: () => void; snapshotDate: string }) {
    const [isHovered, setIsHovered] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const ref = useRef<HTMLButtonElement>(null);

    const updatePosition = useCallback(() => {
        if (ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setPosition({
                left: rect.left + rect.width / 2,
                top: rect.bottom + 8,
            });
        }
    }, []);

    useEffect(() => {
        if (isHovered) updatePosition();
    }, [isHovered, updatePosition]);

    return (
        <>
            <button
                ref={ref}
                onClick={onClick}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                className="interactive-ghost flex items-center justify-center p-1.5 h-auto"
            >
                <TbLink size={16} />
            </button>

            {isHovered && createPortal(
                <div
                    className="fixed z-[999999] bg-surface-overlay border border-border rounded-md shadow-float px-3 py-2 pointer-events-none flex flex-col items-center gap-1"
                    style={{
                        left: position.left,
                        top: position.top,
                        transform: 'translateX(-50%)',
                    }}
                >
                    <span className="text-xs text-text-highlighted font-medium">Copy Link</span>
                    <span className="subtext">snapshot from {timeAgo(snapshotDate)}</span>
                </div>,
                document.body
            )}
        </>
    );
}
