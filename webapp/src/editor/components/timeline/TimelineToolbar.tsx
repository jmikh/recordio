import React, { useMemo, useState, useCallback } from 'react';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { useTimeMapper } from '../../hooks/useTimeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { MdPlayArrow, MdPause, MdAdd, MdRemove } from 'react-icons/md';
import { FaScissors } from 'react-icons/fa6';
import { Slider, Button, Tooltip, AiAudioIcon } from '@shared/components';
import { useToast } from '../Toast';
import { analyzeForAutoCut } from '../../../core/autocut/autoCutAnalyzer';
import { getCachedSpeechSegments } from '../../../core/autocut/vadService';
import { MIN_WINDOW_DURATION_MS } from './tracks/recording/constants';

export const MIN_PIXELS_PER_SEC = 10;
export const MAX_PIXELS_PER_SEC = 200;



export const TimelineToolbar: React.FC = () => {
    // Subscribe for perf
    const timeDisplayRef = React.useRef<HTMLDivElement>(null);
    const isPlaying = useUIStore(s => s.isPlaying);
    const setIsPlaying = useUIStore(s => s.setIsPlaying);
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const setPixelsPerSec = useUIStore(s => s.setPixelsPerSec);
    const timelineContainerRef = useUIStore(s => s.timelineContainerRef);
    const canvasMode = useUIStore(s => s.canvasMode);
    const currentTimeMs = useUIStore(s => s.currentTimeMs);
    const setScissorsHovered = useUIStore(s => s.setScissorsHovered);
    const splitWindow = useProjectStore(s => s.splitWindow);
    const timeline = useProjectTimeline();

    // Derive totalDurationMs internally
    const timeMapper = useTimeMapper();
    const totalDurationMs = timeMapper.getOutputDuration();

    // History Batcher
    const batcher = useHistoryBatcher();

    // AutoCut logic
    const { addToast, updateToast, removeToast } = useToast();
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const userEvents = useProjectStore(s => s.userEvents);
    const screenSource = useProjectStore(s => s.project.screenSource);
    const cameraSource = useProjectStore(s => s.project.cameraSource);
    const micSource = useProjectStore(s => s.project.microphoneSource);
    const sourceDurationMs = useProjectStore(s => s.project.timeline.durationMs);
    const setOutputWindows = useProjectStore(s => s.setOutputWindows);

    const hasMic = !!micSource?.runtimeUrl;
    const hasUserEvents = userEvents.mousePositions.length > 0;
    const showAutoCut = hasMic && (!!cameraSource || hasUserEvents);

    const handleAutoCut = useCallback(async () => {
        if (isAnalyzing) return;
        setIsAnalyzing(true);

        const toastId = addToast({
            type: 'progress',
            title: 'Analyzing audio...',
            message: 'Detecting speech segments'
        });

        try {
            const audioUrl = micSource?.runtimeUrl || '';

            const hasAudio = Boolean(audioUrl);
            let speechSegments: { startMs: number; endMs: number }[] = [];

            if (hasAudio) {
                speechSegments = await getCachedSpeechSegments(audioUrl);
                if (speechSegments.length === 0) {
                    throw new Error('VAD detected no speech in audio. The audio may be silent or there may be an issue with the analysis.');
                }
            }

            const { windows, totalRemovedMs } = analyzeForAutoCut(
                speechSegments,
                userEvents,
                sourceDurationMs
            );

            if (windows.length > 0) {
                setOutputWindows(windows);
                useProjectStore.getState().updateSettings({ autoCutApplied: true });
                const seconds = (totalRemovedMs / 1000).toFixed(1);
                if (totalRemovedMs > 0) {
                    updateToast(toastId, { type: 'success', title: `Trimmed ${seconds}s of silence` });
                } else {
                    updateToast(toastId, { type: 'info', title: 'No silence detected' });
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
    }, [isAnalyzing, micSource, cameraSource, screenSource, userEvents, sourceDurationMs, setOutputWindows, addToast, updateToast, removeToast]);

    const handleScaleChange = (newScale: number) => {
        setPixelsPerSec(newScale);
    };

    const handleFit = () => {
        const container = timelineContainerRef?.current;
        if (!container) return;
        const availableWidth = container.clientWidth - 50;
        if (totalDurationMs > 0) {
            const fitPps = (availableWidth * 1000) / totalDurationMs;
            const clampedPps = Math.max(MIN_PIXELS_PER_SEC, Math.min(MAX_PIXELS_PER_SEC, fitPps));
            setPixelsPerSec(clampedPps);
        }
    };

    // Check if current time is at least MIN_WINDOW_DURATION_MS from both window boundaries (in output time)
    const canSplit = useMemo(() => {
        if (canvasMode !== CanvasMode.Preview || isPlaying) return false;
        const timeMapper = getTimeMapper(timeline.outputWindows);
        const result = timeMapper.getWindowAtOutputTime(currentTimeMs);
        if (!result) return false;
        const { window: win, outputStartMs } = result;
        const speed = win.speed || 1.0;
        const windowOutputDuration = (win.endMs - win.startMs) / speed;
        const windowOutputEndMs = outputStartMs + windowOutputDuration;
        const distanceFromStart = currentTimeMs - outputStartMs;
        const distanceFromEnd = windowOutputEndMs - currentTimeMs;
        return distanceFromStart >= MIN_WINDOW_DURATION_MS && distanceFromEnd >= MIN_WINDOW_DURATION_MS;
    }, [currentTimeMs, timeline.outputWindows, canvasMode, isPlaying]);

    const handleSplit = () => {
        const timeMapper = getTimeMapper(timeline.outputWindows);
        const result = timeMapper.getWindowAtOutputTime(currentTimeMs);
        if (!result) return;
        const { window: win, outputStartMs } = result;
        const outputOffset = currentTimeMs - outputStartMs;
        const speed = win.speed || 1.0;
        const sourceOffset = outputOffset * speed;
        splitWindow(win.id, win.startMs + sourceOffset);
    };

    const onTogglePlay = () => {
        if (!isPlaying && useUIStore.getState().currentTimeMs >= timeMapper.outputDuration) {
            useUIStore.getState().setCurrentTime(0);
        }
        setIsPlaying(!isPlaying);
    };



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
        <div className="h-10 flex items-center px-4 bg-surface-raised rounded-xl border border-border shrink-0 m-1">
            {/* Left: Scissors cut button & AutoCut */}
            <div className="flex-1 flex items-center gap-2">
                <Tooltip
                    text={canSplit ? 'Cut at playhead' : `Cannot cut — segment <${(MIN_WINDOW_DURATION_MS / 1000).toFixed(1)}s`}
                    position="top-start"
                >
                    <Button
                        variant="icon"
                        disabled={!canSplit}
                        onClick={canSplit ? handleSplit : undefined}
                        onMouseEnter={() => setScissorsHovered(true)}
                        onMouseLeave={() => setScissorsHovered(false)}
                        className={!canSplit ? 'opacity-40 cursor-not-allowed' : ''}
                    >
                        <FaScissors size={13} />
                    </Button>
                </Tooltip>

                {showAutoCut && (
                    <Tooltip text="Remove silent and inactive segments" position="top-start">
                        <Button
                            variant="icon"
                            disabled={isAnalyzing}
                            onClick={handleAutoCut}
                            className={isAnalyzing ? 'animate-pulse' : ''}
                        >
                            <AiAudioIcon size={18} />
                        </Button>
                    </Tooltip>
                )}
            </div>

            {/* Center: play button + time */}
            <div className="flex items-center gap-3">
                <button
                    onClick={onTogglePlay}
                    className="w-7 h-7 rounded-full border-2 border-primary text-primary hover:border-primary-highlighted hover:text-primary-highlighted hover:scale-110 transition-all flex items-center justify-center shrink-0"
                >
                    {isPlaying ? <MdPause size={18} /> : <MdPlayArrow size={18} />}
                </button>
                <div className="flex items-baseline gap-1.5">
                    <div
                        ref={timeDisplayRef}
                        className="text-sm text-text-main tabular-nums"
                    >
                        00:00.0
                    </div>
                    <span className="text-xs text-text-muted">/</span>
                    <div className="text-xs text-text-muted tabular-nums">
                        {formatSmartTime(totalDurationMs, totalDurationMs)}
                    </div>
                </div>
            </div>

            {/* Right: zoom controls */}
            <div className="flex-1 flex items-center justify-end gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleFit}
                    className="px-2 py-0.5"
                    title="Fit timeline to screen"
                >
                    Fit
                </Button>
                <Button
                    variant="icon"
                    onClick={() => handleScaleChange(Math.max(MIN_PIXELS_PER_SEC, pixelsPerSec - 10))}
                >
                    <MdRemove size={14} />
                </Button>
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
                <Button
                    variant="icon"
                    onClick={() => handleScaleChange(Math.min(MAX_PIXELS_PER_SEC, pixelsPerSec + 10))}
                >
                    <MdAdd size={14} />
                </Button>
            </div>
        </div>
    );
};

