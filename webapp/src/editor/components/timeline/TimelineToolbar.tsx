import React, { useMemo, useState, useCallback } from 'react';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { useMediaUrlStore } from '../../../storage/useMediaUrlStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { useTimeMapper } from '../../hooks/useTimeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { LuEraser, LuMinus, LuPause, LuPlay, LuPlus, LuScissors } from 'react-icons/lu';
import { TbBlur } from 'react-icons/tb';
import { Slider, Button, Tooltip } from '@shared/components';
import { useToast } from '../../../components/Toast';
import { analyzeForAutoCut } from '../../autocut/autoCutAnalyzer';
import { getCachedSpeechSegments } from '../../autocut/vadService';
import { MIN_WINDOW_DURATION_MS } from './tracks/clip/constants';
import { getValidBlockRange } from './tracks/shared/timelineTrackUtils';
import { K_DEFAULT_TIMELINE_BLOCK_MS, K_MIN_TIMELINE_BLOCK_MS } from './tracks/shared/useTimelineSegmentDrag';
import { getActiveBlurSegment } from '@shared/painters/blurPainter';
import { createBlurSegment, createDefaultBlurRegion } from '../../blur/blurDefaults';
import { trackAutocutClicked, trackAutocutFailed } from '../../../analytics';
import { captureError } from '../../../lib/sentry';
import { MIN_PIXELS_PER_SEC, MAX_PIXELS_PER_SEC, fitTimelineToScreen } from './fitTimeline';



export const TimelineToolbar: React.FC = () => {
    // Subscribe for perf
    const timeDisplayRef = React.useRef<HTMLDivElement>(null);

    const isPlaying = useUIStore(s => s.isPlaying);
    const setIsPlaying = useUIStore(s => s.setIsPlaying);
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const setPixelsPerSec = useUIStore(s => s.setPixelsPerSec);
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

    const micUrl = useMediaUrlStore(s => micSource ? s.urls[micSource.storagePath] : undefined);
    const hasMic = !!micUrl;
    const hasUserEvents = userEvents.mousePositions.length > 0;
    const showAutoCut = hasMic && (!!cameraSource || hasUserEvents);

    const projectId = useProjectStore(s => s.project.id);

    const handleAutoCut = useCallback(async () => {
        if (isAnalyzing) return;
        trackAutocutClicked(projectId);
        setIsAnalyzing(true);

        const toastId = addToast({
            type: 'progress',
            title: 'Analyzing audio...',
            message: 'Detecting speech segments'
        });

        try {
            const audioUrl = micSource ? (useMediaUrlStore.getState().urls[micSource.storagePath] || '') : '';

            const hasAudio = Boolean(audioUrl);
            let speechSegments: { startMs: number; endMs: number }[] = [];

            if (hasAudio) {
                speechSegments = await getCachedSpeechSegments(audioUrl);
                if (speechSegments.length === 0) {
                    throw new Error('VAD detected no speech in audio. The audio may be silent or there may be an issue with the analysis.');
                }
            }

            const currentWindows = useProjectStore.getState().project.timeline.outputWindows;
            const { windows, totalRemovedMs } = analyzeForAutoCut(
                speechSegments,
                userEvents,
                sourceDurationMs,
                currentWindows
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
        } catch (error: any) {
            captureError(error, { flow: 'autocut', projectId });
            trackAutocutFailed({
                project_id: projectId,
                error: error?.message || 'Unknown error',
                error_name: error?.name,
                is_offline: !navigator.onLine,
            });
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

    const handleFit = () => fitTimelineToScreen(totalDurationMs);

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

    // Add blur at the playhead: inside a blur block → another region in it;
    // otherwise a new block in the free space around the playhead.
    const blurSegments = timeline.blurSegments;
    const blurTarget = useMemo(() => {
        const segments = (blurSegments || []).filter(s => s.visible);
        const existing = getActiveBlurSegment(segments, currentTimeMs);
        if (existing) return { kind: 'region' as const, segment: existing };
        const range = getValidBlockRange(currentTimeMs, segments, totalDurationMs, K_MIN_TIMELINE_BLOCK_MS, K_DEFAULT_TIMELINE_BLOCK_MS);
        return range ? { kind: 'segment' as const, range } : null;
    }, [blurSegments, currentTimeMs, totalDurationMs]);

    const handleAddBlur = useCallback(() => {
        if (!blurTarget) return;
        const { project, addBlurSegment, addBlurRegion } = useProjectStore.getState();
        const outputSize = project.settings.outputSize;

        if (blurTarget.kind === 'region') {
            const region = createDefaultBlurRegion(outputSize, blurTarget.segment.regions.length);
            addBlurRegion(blurTarget.segment.id, region);
            useUIStore.getState().selectBlurSegment(blurTarget.segment.id, region.id);
            return;
        }

        const segment = createBlurSegment(blurTarget.range.start, blurTarget.range.end, timeMapper, outputSize);
        addBlurSegment(segment);
        useUIStore.getState().selectBlurSegment(segment.id);
    }, [blurTarget, timeMapper]);

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
        <div className="h-10 flex items-center px-4 bg-surface rounded-xl border border-border shrink-0 m-1">
            {/* Left: Scissors cut button & AutoCut */}
            <div className="flex-1 flex items-center gap-2">
                <Tooltip
                    text={canSplit ? 'Cut at playhead' : `Cannot cut — segment <${(MIN_WINDOW_DURATION_MS / 1000).toFixed(1)}s`}
                    position="top-start"
                >
                    <Button
                        variant="ghost"
                        disabled={!canSplit}
                        onClick={canSplit ? handleSplit : undefined}
                        onMouseEnter={() => setScissorsHovered(true)}
                        onMouseLeave={() => setScissorsHovered(false)}
                        className={!canSplit ? 'opacity-40 cursor-not-allowed' : ''}
                    >
                        <LuScissors className="icon-sm" />
                    </Button>
                </Tooltip>

                {showAutoCut && (
                    <Tooltip text="Remove silent and inactive segments" position="top-start">
                        <Button
                            variant="ghost"
                            disabled={isAnalyzing}
                            onClick={handleAutoCut}
                            aria-label="Remove silent and inactive segments"
                            className={isAnalyzing ? 'animate-pulse' : ''}
                        >
                            <LuEraser className="icon-sm" />
                        </Button>
                    </Tooltip>
                )}

                <div className="w-px h-5 bg-border mx-1" />

                <Tooltip
                    text={blurTarget ? 'Blur part of the screen at the playhead' : 'No room for a blur block here'}
                    position="top-start"
                >
                    <Button
                        variant="ghost"
                        icon={TbBlur}
                        disabled={!blurTarget}
                        onClick={handleAddBlur}
                        className={!blurTarget ? 'opacity-40 cursor-not-allowed' : ''}
                    >
                        Add blur
                    </Button>
                </Tooltip>
            </div>

            {/* Center: play button + time */}
            <div className="flex items-center gap-3">
                <button
                    onClick={onTogglePlay}
                    className="w-7 h-7 rounded-full border-2 border-primary text-primary hover:border-primary-highlighted hover:text-primary-highlighted hover:scale-110 transition-all flex items-center justify-center shrink-0"
                >
                    {isPlaying ? <LuPause className="icon-lg" /> : <LuPlay className="icon-lg" />}
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
                <Tooltip text="Fit timeline to screen">
                    <Button
                        variant="ghost"
                        onClick={handleFit}
                        className="px-2 py-0.5"
                    >
                        Fit
                    </Button>
                </Tooltip>
                <Button
                    variant="ghost"
                    icon={LuMinus}
                    aria-label="Zoom out timeline"
                    onClick={() => handleScaleChange(Math.max(MIN_PIXELS_PER_SEC, pixelsPerSec - 10))}
                />
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
                    variant="ghost"
                    icon={LuPlus}
                    aria-label="Zoom in timeline"
                    onClick={() => handleScaleChange(Math.min(MAX_PIXELS_PER_SEC, pixelsPerSec + 10))}
                />
            </div>
        </div>
    );
};

