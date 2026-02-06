import React, { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { useToast } from '../Toast';
import { analyzeForAutoCut } from '../../../core/autocut/autoCutAnalyzer';
import { getCachedSpeechSegments } from '../../../core/autocut/vadService';

import { MdPlayArrow, MdPause, MdAdd, MdRemove, MdDelete, MdContentCut, MdRefresh } from 'react-icons/md';
import { Slider, DefaultButton } from '@shared/components';


interface TimelineToolbarProps {
    totalDurationMs: number;
    onFit: () => void;
}

export const MIN_PIXELS_PER_SEC = 10;
export const MAX_PIXELS_PER_SEC = 200;



export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
    totalDurationMs,
    onFit,
}) => {
    // Stores
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);

    // Delete actions
    const removeOutputWindow = useProjectStore(s => s.removeOutputWindow);
    const deleteZoomAction = useProjectStore(s => s.deleteZoomAction);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);

    // Selection state
    const selectedWindowId = useUIStore(s => s.selectedWindowId);
    const selectedZoomId = useUIStore(s => s.selectedZoomId);
    const selectedSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);

    // Subscribe for perf
    const timeDisplayRef = React.useRef<HTMLDivElement>(null);
    const isPlaying = useUIStore(s => s.isPlaying);
    const setIsPlaying = useUIStore(s => s.setIsPlaying);
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const setPixelsPerSec = useUIStore(s => s.setPixelsPerSec);

    // History Batcher
    const batcher = useHistoryBatcher();

    // Toast for AutoCut feedback
    const { addToast, updateToast, removeToast } = useToast();

    // AutoCut: Get user events and sources for audio analysis
    const userEvents = useProjectStore(s => s.project.userEvents);
    const screenSource = useProjectStore(s => s.project.screenSource);
    const cameraSource = useProjectStore(s => s.project.cameraSource);
    const setOutputWindows = useProjectStore(s => s.setOutputWindows);
    const sourceDurationMs = useProjectStore(s => s.project.timeline.durationMs);

    // AutoCut loading state
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // AutoCut Visibility Logic:
    // 1. Camera exists and has microphone
    // OR
    // 2. Camera doesn't exist (or no mic), Screen has microphone, and User Events exist
    const cameraHasMic = cameraSource?.has_microphone && cameraSource?.runtimeUrl;
    const screenHasMic = screenSource.has_microphone && screenSource.runtimeUrl;
    const hasUserEvents = userEvents.mousePositions.length > 0;

    const showAutoCut = (cameraHasMic) || (screenHasMic && hasUserEvents);

    // Handlers

    const handleScaleChange = (newScale: number) => {
        setPixelsPerSec(newScale);
    };



    const onTogglePlay = () => setIsPlaying(!isPlaying);

    // Delete button logic
    const handleDelete = () => {
        // Can only delete window if it's NOT the last one
        if (selectedZoomId) {
            deleteZoomAction(selectedZoomId);
            setCanvasMode(CanvasMode.Preview);
        } else if (selectedSpotlightId) {
            deleteSpotlight(selectedSpotlightId);
            setCanvasMode(CanvasMode.Preview);
        } else if (selectedWindowId && outputWindows.length > 1) {
            removeOutputWindow(selectedWindowId);
        }
    };

    // AutoCut handler (async VAD analysis)
    const handleAutoCut = async () => {
        if (isAnalyzing) return;

        setIsAnalyzing(true);

        // Show progress toast
        const toastId = addToast({
            type: 'progress',
            title: 'Analyzing audio...',
            message: 'Detecting speech segments'
        });

        try {
            // Select audio source: Prefer Camera if it has mic, otherwise Screen if it has mic
            const cameraHasMic = cameraSource?.has_microphone && cameraSource?.runtimeUrl;
            const screenHasMic = screenSource.has_microphone && screenSource.runtimeUrl;

            const audioUrl = cameraHasMic
                ? (cameraSource?.runtimeUrl || '')
                : (screenHasMic ? (screenSource.runtimeUrl || '') : '');

            const hasAudio = Boolean(audioUrl);

            let speechSegments: { startMs: number; endMs: number }[] = [];

            if (hasAudio) {
                // Audio exists - use VAD
                speechSegments = await getCachedSpeechSegments(audioUrl);

                if (speechSegments.length === 0) {
                    // VAD found no speech with audio present - something's wrong
                    throw new Error('VAD detected no speech in audio. The audio may be silent or there may be an issue with the analysis.');
                }
            }
            // If no audio, speechSegments stays empty and we rely on events only

            // Run AutoCut analysis
            const { windows, totalRemovedMs } = analyzeForAutoCut(
                speechSegments,
                userEvents,
                sourceDurationMs
            );

            if (windows.length > 0) {
                setOutputWindows(windows);

                // Show success toast
                const seconds = (totalRemovedMs / 1000).toFixed(1);
                if (totalRemovedMs > 0) {
                    updateToast(toastId, {
                        type: 'success',
                        title: `Trimmed ${seconds}s of silence`
                    });
                } else {
                    updateToast(toastId, {
                        type: 'info',
                        title: 'No silence detected'
                    });
                }
            } else {
                removeToast(toastId);
            }
        } catch (error) {
            console.error('AutoCut failed:', error);
            updateToast(toastId, {
                type: 'error',
                title: 'AutoCut failed',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        } finally {
            setIsAnalyzing(false);
        }
    };

    const canDeleteWindow = selectedWindowId && outputWindows.length > 1;
    const isDeleteEnabled = canDeleteWindow || Boolean(selectedZoomId) || Boolean(selectedSpotlightId);

    // Helper format
    const formatSmartTime = (ms: number, totalMs: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const deciseconds = Math.floor((ms % 1000) / 100);

        const hasHours = totalMs >= 3600000;

        if (hasHours) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${deciseconds}`;
        } else {
            return `${minutes}:${seconds.toString().padStart(2, '0')}.${deciseconds}`;
        }
    };

    // perf: Update time without re-render
    React.useEffect(() => {
        const updateTimeDisplay = () => {
            if (timeDisplayRef.current) {
                const time = useUIStore.getState().currentTimeMs;
                timeDisplayRef.current.textContent = formatSmartTime(Math.max(0, time), totalDurationMs);
            }
        };

        // Initial set
        updateTimeDisplay();

        const unsub = useUIStore.subscribe((state) => {
            if (timeDisplayRef.current) {
                timeDisplayRef.current.textContent = formatSmartTime(Math.max(0, state.currentTimeMs), totalDurationMs);
            }
        });
        return unsub;
    }, [totalDurationMs]);


    return (
        <div className="h-10 flex items-center px-4 p-4 bg-surface  border-b border-border-selected shrink-0 justify-between">
            <div className="flex items-center gap-2">
                {/* Delete Button */}
                <DefaultButton
                    onClick={handleDelete}
                    className="px-3 py-1 text-xs flex items-center gap-1"
                    title={
                        selectedWindowId && outputWindows.length <= 1
                            ? "Cannot delete the last window"
                            : "Delete selected item"
                    }
                    disabled={!isDeleteEnabled}
                >
                    <MdDelete size={14} />
                    Delete
                </DefaultButton>

                {/* AutoCut Button */}
                {showAutoCut && (
                    <DefaultButton
                        onClick={handleAutoCut}
                        className="px-3 py-1 text-xs flex items-center gap-1"
                        title="Remove silent/inactive segments"
                        disabled={isAnalyzing}
                    >
                        <MdContentCut size={14} />
                        AutoCut
                    </DefaultButton>
                )}

                {/* Reset Windows Button */}
                <DefaultButton
                    onClick={() => {
                        setOutputWindows([{
                            id: crypto.randomUUID(),
                            startMs: 0,
                            endMs: sourceDurationMs,
                            speed: 1.0
                        }]);
                    }}
                    className="px-3 py-1 text-xs flex items-center gap-1"
                    title="Reset to single window"
                >
                    <MdRefresh size={14} />
                    Reset
                </DefaultButton>
            </div>

            <div className="flex items-center gap-4 bg-state-inactive px-4 py-1 rounded-full border border-border">
                <button onClick={onTogglePlay} className="hover:text-primary transition-colors flex items-center justify-center p-0.5 text-text-highlighted">
                    {isPlaying ? <MdPause size={18} /> : <MdPlayArrow size={18} />}
                </button>
                <div className="flex items-baseline gap-1.5">
                    <div
                        ref={timeDisplayRef}
                        className="font-mono text-sm text-text-main tabular-nums"
                    >
                        00:00.0
                    </div>
                    <span className="text-xs text-text-muted">/</span>
                    <div className="font-mono text-xs text-text-muted tabular-nums">
                        {formatSmartTime(totalDurationMs, totalDurationMs)}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <DefaultButton
                    onClick={onFit}
                    className="px-2 py-0.5 text-[10px]"
                    title="Fit timeline to screen"
                >
                    Fit
                </DefaultButton>
                <button
                    onClick={() => handleScaleChange(Math.max(MIN_PIXELS_PER_SEC, pixelsPerSec - 10))}
                    className="hover:text-primary transition-colors text-text-main"
                >
                    <MdRemove size={14} />
                </button>
                <div className="w-24">
                    <Slider
                        value={pixelsPerSec}
                        onChange={handleScaleChange}
                        min={MIN_PIXELS_PER_SEC}
                        max={MAX_PIXELS_PER_SEC}
                        onPointerDown={batcher.startInteraction}
                        onPointerUp={batcher.endInteraction}
                    />
                </div>
                <button
                    onClick={() => handleScaleChange(Math.min(MAX_PIXELS_PER_SEC, pixelsPerSec + 10))}
                    className="hover:text-primary transition-colors text-text-main"
                >
                    <MdAdd size={14} />
                </button>
            </div>
        </div>
    );
};
