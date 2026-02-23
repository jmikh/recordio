import { useState } from 'react';
import { useProjectStore, useProjectData, useProjectHistory } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { FaUndo, FaRedo } from 'react-icons/fa';
import { MdDarkMode, MdLightMode } from 'react-icons/md';
import { BiSupport } from 'react-icons/bi';


import { AuthModal } from './AuthModal';
import { SupportModal } from '../../../components/SupportModal';
import { UserMenu } from './UserMenu';
import { UpgradeModal } from './UpgradeModal';
import { useUserStore } from '../../stores/useUserStore';
import { LogoLink } from '@shared/components';


export const Header = () => {
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
    const { isAuthenticated, theme, setTheme } = useUserStore();

    const project = useProjectData();
    const updateProjectName = useProjectStore(s => s.updateProjectName);
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const pastStates = useProjectHistory(state => state.pastStates);
    const futureStates = useProjectHistory(state => state.futureStates);

    return (
        <div id="editor-header" className="bg-surface border-b border-border flex flex-col shrink-0 z-[var(--z-index-navbar)] select-none" style={{ boxShadow: 'var(--shadow-panel)' }}>
            {/* Top Row: Main Controls */}
            <div className="h-12 flex items-center px-4 justify-between relative w-full">
                <div className="flex items-center gap-4">
                    <LogoLink className="mr-2" imgClassName="h-7" />
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

                {/* Project Name (Centered in Top Row) */}
                <input
                    id="project-name-input"
                    type="text"
                    value={project.name}
                    onChange={(e) => updateProjectName(e.target.value)}
                    maxLength={40}
                    className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 bg-state-inactive text-text-main text-sm text-center border border-border focus:text-text-highlighted hover:bg-state-hover hover:border-border-highlighted focus:bg-state-hover focus:border-border-highlighted rounded px-2 py-0.5 transition-colors placeholder-text-main w-[300px] focus-ring"
                    placeholder="Untitled Project"
                />

                <div className="flex items-center gap-4">
                    {/* User Authentication */}
                    {isAuthenticated ? (
                        <UserMenu onOpenUpgradeModal={() => setIsUpgradeModalOpen(true)} />
                    ) : (
                        <button onClick={() => setIsAuthModalOpen(true)} title="Sign in to unlock Pro features" className="interactive-ghost flex items-center justify-center gap-2">
                            Sign In
                        </button>
                    )}
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
