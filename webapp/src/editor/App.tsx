import { useState, useEffect, useRef, useCallback } from 'react';
import { CanvasContainer } from './components/canvas/CanvasContainer';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { useProjectStore, useProjectData, useProjectHistory } from './stores/useProjectStore';
import { Timeline } from './components/timeline/Timeline';
import { useUIStore, CanvasMode } from './stores/useUIStore';
import { getTimeMapper } from './hooks/useTimeMapper';


import { ProjectStorage } from '../storage/projectStorage';
import { ProgressModal } from '@shared/components';
import { formatTimeCode } from './utils';
import { DebugBar } from './components/DebugBar';
import { Header } from './components/header/Header';
import { useToast } from './components/Toast';
import { useHistoryBatcher } from './hooks/useHistoryBatcher';
import { Slider } from '@shared/components';

// Auth imports
import { AuthManager, supabase } from '../auth/AuthManager';
import { useUserStore } from './stores/useUserStore';



function Editor() {
    const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
    const [containerSize, setContainerSize] = useState({ width: 800, height: 450 });

    // -- Project State --
    const project = useProjectData();

    const loadProject = useProjectStore(s => s.loadProject);
    const undo = useProjectHistory(state => state.undo);
    const redo = useProjectHistory(state => state.redo);
    const showDebugBar = useUIStore(s => s.showDebugBar);
    const canvasMode = useUIStore(s => s.canvasMode);
    const activeSpotlightId = useUIStore(s => s.selectedSpotlightId);

    // Export state (must be at top level - Rules of Hooks)
    const isExporting = useProjectStore(s => s.exportState.isExporting);
    const exportProgress = useProjectStore(s => s.exportState.progress);
    const timeRemainingSeconds = useProjectStore(s => s.exportState.timeRemainingSeconds);


    // Initialization State
    const [isLoading, setIsLoading] = useState(true);
    const hasShownCreationToast = useRef(false);

    // Spotlight scale editing
    const updateSpotlight = useProjectStore(s => s.updateSpotlight);
    const { batchAction } = useHistoryBatcher();
    const activeSpotlight = activeSpotlightId
        ? project.timeline.spotlightSegments.find(s => s.id === activeSpotlightId)
        : null;
    const isSpotlightEditing = canvasMode === CanvasMode.SpotlightEdit && !!activeSpotlight;

    const handleScaleChange = useCallback((newScale: number) => {
        if (!activeSpotlightId) return;
        batchAction(() => {
            updateSpotlight(activeSpotlightId, { scale: newScale });
        });
    }, [activeSpotlightId, batchAction, updateSpotlight]);

    // Initialize authentication
    useEffect(() => {
        if (!supabase) {
            console.log('[Auth] Supabase not configured - auth features disabled');
            return;
        }

        // Check if this is an OAuth callback (tokens in URL hash)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');

        if (accessToken) {
            console.log('[Auth] OAuth callback detected - processing tokens...');
            // Supabase will automatically process the hash and create a session
            // Clear the hash after processing to clean up the URL
            setTimeout(() => {
                window.location.hash = '';
                console.log('[Auth] OAuth callback processed, session should be active');
            }, 1000);
        }

        // Initialize auth state listener
        AuthManager.initAuthListener(async (session) => {
            const { setUser, setSubscription, setFreeCreditsUsed, clearUser } = useUserStore.getState();

            if (session) {
                // User is logged in
                console.log('[Auth] User logged in:', session.user.email);

                const { full_name, avatar_url, picture, name } = session.user.user_metadata || {};
                const userName = full_name || name || session.user.email?.split('@')[0] || 'User';
                const userPicture = avatar_url || picture || null;

                setUser(session.user.id, session.user.email || '', userName, userPicture);

                // Fetch subscription status from database
                try {
                    const { data, error } = await supabase!
                        .from('subscriptions')
                        .select('*')
                        .eq('user_id', session.user.id)
                        .maybeSingle();

                    if (error) {
                        console.log('[Auth] No subscription found (user is on free plan)');
                    } else if (data) {
                        setSubscription({
                            status: data.status,
                            planId: data.plan_id,
                            currentPeriodEnd: new Date(data.current_period_end),
                            cancelAtPeriodEnd: data.cancel_at_period_end,
                            stripeCustomerId: data.stripe_customer_id
                        });
                        console.log('[Auth] Subscription status:', data.status);
                    }
                } catch (error) {
                    console.log('[Auth] Subscription table not configured yet - user defaults to free plan');
                }

                // Fetch free export credits from profile
                try {
                    const { data: profile, error: profileError } = await supabase!
                        .from('user_metadata')
                        .select('free_credits_used')
                        .eq('id', session.user.id)
                        .maybeSingle();

                    if (profileError) {
                        console.log('[Auth] Could not fetch profile:', profileError.message);
                    } else if (profile) {
                        setFreeCreditsUsed(profile.free_credits_used ?? 0);
                        console.log('[Auth] Free credits used:', profile.free_credits_used ?? 0);
                    }
                } catch (error) {
                    console.log('[Auth] Profile table not configured yet');
                }
            } else {
                // User is logged out
                console.log('[Auth] User logged out');
                clearUser();
            }
        });

        // Check initial session
        AuthManager.getSession().then((session) => {
            if (session) {
                const { setUser } = useUserStore.getState();
                const { full_name, avatar_url, picture, name } = session.user.user_metadata || {};
                const userName = full_name || name || session.user.email?.split('@')[0] || 'User';
                const userPicture = avatar_url || picture || null;

                setUser(session.user.id, session.user.email || '', userName, userPicture);
            }
        });
    }, []);

    // Toast hook for project creation notifications
    const { addToast } = useToast();

    // Load Project ID from URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('projectId');

        async function init() {
            if (!projectId) {
                // No project ID - redirect to dashboard
                window.location.href = '/';
                return;
            }
            try {
                console.log('Initializing Project:', projectId);
                const loadedProject = await ProjectStorage.loadProjectOrFail(projectId);
                loadProject(loadedProject);
                setIsLoading(false);

                // Show creation toast only if project was created in the last 10 seconds
                const projectAge = Date.now() - new Date(loadedProject.createdAt).getTime();
                const isNewlyCreated = projectAge < 10000; // 10 seconds

                if (isNewlyCreated && !hasShownCreationToast.current) {
                    hasShownCreationToast.current = true;
                    const hasUserEvents = loadedProject.userEvents.mousePositions.length > 0;
                    if (hasUserEvents) {
                        const zoomCount = loadedProject.timeline.zoomSegments.length;
                        const spotlightCount = loadedProject.timeline.spotlightSegments.length;

                        // Build message conditionally - only show counts > 0
                        const parts: string[] = [];
                        if (zoomCount > 0) parts.push(`${zoomCount} zoom${zoomCount !== 1 ? 's' : ''}`);
                        if (spotlightCount > 0) parts.push(`${spotlightCount} spotlight${spotlightCount !== 1 ? 's' : ''}`);

                        addToast({
                            type: 'success',
                            title: 'Recording Ready!',
                            message: parts.length > 0 ? `Generated ${parts.join(' and ')}` : undefined,
                        });
                    } else {
                        addToast({
                            type: 'info',
                            title: 'No Auto Effects Generated',
                            message: 'Recordio can only capture interactions of recordings of the current Chrome window.',
                        });
                    }
                }
            } catch (err: any) {
                console.error("Project Init Failed:", err);
                // Redirect to dashboard with error message
                window.location.href = `/?error=${encodeURIComponent('Project not found')}`;
            }
        }

        init();
    }, []);

    // Global Key Listener for Undo/Redo & Play/Pause
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input
            const activeTag = document.activeElement?.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) {
                return;
            }

            // If a button is focused, Space natively triggers its click event.
            // Skip our handler to avoid double-toggling play/pause.
            if (e.code === 'Space' && activeTag === 'button') {
                e.preventDefault();
                return;
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
                return;
            }

            if (e.code === 'Space') {
                e.preventDefault(); // Prevent scrolling
                const { isPlaying, setIsPlaying, currentTimeMs, setCurrentTime } = useUIStore.getState();
                if (!isPlaying) {
                    const windows = useProjectStore.getState().project.timeline.outputWindows;
                    const tm = getTimeMapper(windows);
                    if (currentTimeMs >= tm.outputDuration) {
                        setCurrentTime(0);
                    }
                }
                setIsPlaying(!isPlaying);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo]);


    // Handle Resize for Centering
    useEffect(() => {
        if (!containerElement) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
            }
        });
        ro.observe(containerElement);
        return () => ro.disconnect();
    }, [containerElement]);


    // Derived UI State
    // Check if we have a valid screen source to determine if project is "active" / has content
    const hasActiveProject = !!project.screenSource?.id;
    const projectOutputSize = project.settings.outputSize;

    // Calculate Rendered Rect (for overlay positioning)
    let renderedStyle = { width: '100%', height: '100%' };
    if (projectOutputSize && projectOutputSize.width > 0 && containerSize.width > 0 && containerSize.height > 0) {
        const containerAspect = containerSize.width / containerSize.height;
        const videoAspect = projectOutputSize.width / projectOutputSize.height;

        let rw, rh;
        if (containerAspect > videoAspect) {
            rh = containerSize.height;
            rw = rh * videoAspect;
        } else {
            rw = containerSize.width;
            rh = rw / videoAspect;
        }

        renderedStyle = {
            width: `${rw}px`,
            height: `${rh}px`
        };
    }

    // Loading state
    if (isLoading) {
        return (
            <div className="w-full h-screen bg-surface-body flex items-center justify-center">
                <div className="text-text-main">Loading Project...</div>
            </div>
        );
    }

    // No project loaded (shouldn't happen with redirects, but safety fallback)
    if (!hasActiveProject) {
        window.location.href = '/';
        return null;
    }

    return (
        <div id="editor-root" className="w-full h-screen bg-surface-body flex flex-col overflow-auto" style={{ minWidth: '800px' }}>

            {/* Header / Toolbar */}
            <Header />

            {showDebugBar && (
                <div className="bg-surface-overlay border-b border-border flex flex-col shrink-0 z-[var(--z-index-overlay)] select-none">
                    {/* Bottom Row: Debug Tools */}
                    <DebugBar />
                </div>
            )}

            <div id="editor-body" className="flex-1 flex overflow-hidden">
                <SettingsPanel />
                <div
                    id="video-player-container"
                    className="flex-1 flex overflow-hidden relative items-center justify-center bg-surface"
                >
                    <div
                        id="canvas-sizing-container"
                        ref={setContainerElement}
                        className="relative flex items-center bg-surface justify-center shadow-2xl"
                        style={{
                            width: '100%',
                            height: '100%',
                            overflow: 'hidden'
                        }}
                    >

                        {/* SPOTLIGHT SCALE TOOLBAR — absolute overlay at top */}
                        {isSpotlightEditing && activeSpotlight && (
                            <div id="canvas-spotlight-toolbar" className="absolute top-4 left-1/2 -translate-x-1/2 z-[var(--z-index-tooltip)] w-full max-w-xs">
                                <div className="bg-surface-overlay border border-border rounded-lg shadow-float px-3 py-2">
                                    <Slider
                                        value={activeSpotlight.scale}
                                        onChange={handleScaleChange}
                                        min={1}
                                        max={2}
                                        label="Enlarge"
                                        showTooltip
                                        decimals={2}
                                        units="x"
                                    />
                                </div>
                            </div>
                        )}

                        {hasActiveProject && (
                            <div
                                id="canvas-rendered-wrapper"
                                className="bg-surface"
                                style={{ position: 'relative', ...renderedStyle }}
                            >
                                <CanvasContainer />
                            </div>
                        )}
                        {isLoading && <div className="text-text-main">Loading Project...</div>}
                    </div>
                </div>

            </div>

            <div id="timeline-container" className="border-t border-border shrink-0 z-[var(--z-index-navbar)] bg-surface">
                <Timeline />
            </div>

            <ProgressModal
                isOpen={isExporting}
                title="Exporting Project"
                projectName={project.name}
                progress={exportProgress}
                statusText={
                    timeRemainingSeconds !== null
                        ? `~${formatTimeCode(timeRemainingSeconds * 1000)} remaining`
                        : 'Estimating time...'
                }
                onCancel={() => {
                    const manager = (window as any).__activeExportManager;
                    if (manager) {
                        manager.cancel();
                    }
                }}
            />
        </div>
    );
}

export default Editor;
