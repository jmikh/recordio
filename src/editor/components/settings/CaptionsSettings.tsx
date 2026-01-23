import { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useUserStore } from '../../stores/useUserStore';
import type { CaptionSegment } from '../../../core/types';
import { Slider } from '../../../components/ui/Slider';
import { Toggle } from '../../../components/ui/Toggle';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { useTimeMapper } from '../../hooks/useTimeMapper';
import { TranscriptionService } from '../../../core/TranscriptionService';
import { ProgressModal } from '../../../components/ui/ProgressModal';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { Notice } from '../../../components/ui/Notice';
import { XButton } from '../../../components/ui/XButton';
import { trackCaptionsGenerated } from '../../../core/analytics';

/**
 * Settings panel for managing captions.
 */
export function CaptionsSettings() {
    const project = useProjectStore(state => state.project);
    const updateSettings = useProjectStore(state => state.updateSettings);
    const updateCaptionSegment = useProjectStore(state => state.updateCaptionSegment);
    const deleteCaptionSegment = useProjectStore(state => state.deleteCaptionSegment);
    const isTranscribing = useProjectStore(state => state.isTranscribing);
    const transcriptionProgress = useProjectStore(state => state.transcriptionProgress);
    const transcriptionError = useProjectStore(state => state.transcriptionError);
    const setTranscriptionState = useProjectStore(state => state.setTranscriptionState);
    const setCaptions = useProjectStore(state => state.setCaptions);

    // UI Store actions
    const setCanvasMode = useUIStore(state => state.setCanvasMode);
    const setIsPlaying = useUIStore(state => state.setIsPlaying);
    const setCurrentTime = useUIStore(state => state.setCurrentTime);

    const { batchAction, startInteraction, endInteraction } = useHistoryBatcher();
    const [editingId, setEditingId] = useState<string | null>(null);
    const inputRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const captions = project.timeline.captions;
    const settings = project.settings.captions || { visible: true, size: 24, width: 75 };

    const timeMapper = useTimeMapper();

    // Focus when editing starts
    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editingId]);

    const handleGenerate = async () => {
        const state = useProjectStore.getState();
        const cameraSourceId = state.project.timeline.cameraSourceId;
        const screenSourceId = state.project.timeline.screenSourceId;

        // Determine which source has microphone
        let sourceToTranscribe = null;
        let sourceName = '';

        // Check camera source first
        if (cameraSourceId) {
            const cameraSource = Object.values(state.sources).find((s: any) => s.id === cameraSourceId);
            if (cameraSource && cameraSource.has_microphone) {
                sourceToTranscribe = cameraSource;
                sourceName = 'camera';
            }
        }

        // Fall back to screen source if camera doesn't have microphone
        if (!sourceToTranscribe && screenSourceId) {
            const screenSource = Object.values(state.sources).find((s: any) => s.id === screenSourceId);
            if (screenSource && screenSource.has_microphone) {
                sourceToTranscribe = screenSource;
                sourceName = 'screen';
            }
        }


        // If no source has microphone, return early (this shouldn't happen as panel is hidden)
        if (!sourceToTranscribe) {
            console.error('[CaptionsSettings] No microphone audio available for transcription');
            return;
        }

        console.log(`[CaptionsSettings] Using ${sourceName} source for transcription`);

        try {
            console.log('[CaptionsSettings] Starting transcription generation');

            // Pause playback
            setIsPlaying(false);

            // Setup AbortController
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();
            const signal = abortControllerRef.current.signal;

            setTranscriptionState({
                isTranscribing: true,
                transcriptionProgress: 0,
                transcriptionError: null
            });

            // Fetch video
            const response = await fetch(sourceToTranscribe.url);
            if (!response.ok) throw new Error(`Failed to fetch video: ${response.statusText}`);
            const videoBlob = await response.blob();

            if (signal.aborted) throw new Error('Aborted');

            // Run transcription
            const transcriptionService = TranscriptionService.getInstance();
            const transcriptionData = await transcriptionService.transcribeWebcamAudio(
                videoBlob,
                (progress) => {
                    setTranscriptionState({ transcriptionProgress: progress });
                },
                signal
            );

            // Success
            setCaptions(transcriptionData);

            // Track caption generation
            const { isAuthenticated, isPro } = useUserStore.getState();
            trackCaptionsGenerated({
                segment_count: transcriptionData.segments.length,
                is_authenticated: isAuthenticated,
                is_pro: isPro,
            });

            setTranscriptionState({
                isTranscribing: false,
                transcriptionProgress: 1
            });

        } catch (error: any) {
            if (error.message === 'Aborted') {
                console.log('[CaptionsSettings] Transcription cancelled');
                setTranscriptionState({ isTranscribing: false });
                return;
            }
            console.error('[CaptionsSettings] Failed to generate transcription:', error);
            setTranscriptionState({
                isTranscribing: false,
                transcriptionError: error instanceof Error ? error.message : 'Unknown error occurred'
            });
        } finally {
            if (abortControllerRef.current?.signal.aborted) {
                abortControllerRef.current = null;
            }
        }
    };

    const handleCancel = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    };

    const formatTime = (ms: number) => {
        const seconds = ms / 1000;
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(1);
        return `${mins}:${secs.padStart(4, '0')}`;
    };

    const handleEditStart = (segment: CaptionSegment) => {
        setEditingId(segment.id);

        // Enter CaptionEdit mode and pause
        setCanvasMode(CanvasMode.CaptionEdit);
        setIsPlaying(false);

        // Move CTI to the start of the caption in output time
        const outputRange = timeMapper.mapSourceRangeToOutputRange(segment.sourceStartMs, segment.sourceEndMs);
        if (outputRange) {
            setCurrentTime(outputRange.start);
        }

        startInteraction();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Prevent Enter key from creating newlines
        if (e.key === 'Enter') {
            e.preventDefault();
            // Blur to save
            if (inputRef.current) {
                inputRef.current.blur();
            }
        }
    };

    const handleInput = (e: React.FormEvent<HTMLDivElement>, segmentId: string) => {
        const text = e.currentTarget.textContent || '';

        // Save cursor position before update
        const selection = window.getSelection();
        const range = selection?.getRangeAt(0);
        const cursorOffset = range?.startOffset || 0;
        const cursorNode = range?.startContainer;

        // Enforce 200 character limit
        if (text.length > 200) {
            // Truncate to 200 characters while preserving cursor position
            const truncated = text.substring(0, 200);
            e.currentTarget.textContent = truncated;

            // Move cursor to end
            const newRange = document.createRange();
            const newSelection = window.getSelection();
            newRange.selectNodeContents(e.currentTarget);
            newRange.collapse(false);
            newSelection?.removeAllRanges();
            newSelection?.addRange(newRange);

            // Update with truncated text
            batchAction(() => {
                updateCaptionSegment(segmentId, { text: truncated });
            });
        } else {
            // Update in real-time
            batchAction(() => {
                updateCaptionSegment(segmentId, { text });
            });

            // Restore cursor position after React re-render
            requestAnimationFrame(() => {
                if (cursorNode && inputRef.current?.contains(cursorNode)) {
                    try {
                        const newRange = document.createRange();
                        newRange.setStart(cursorNode, Math.min(cursorOffset, cursorNode.textContent?.length || 0));
                        newRange.collapse(true);
                        const newSelection = window.getSelection();
                        newSelection?.removeAllRanges();
                        newSelection?.addRange(newRange);
                    } catch (e) {
                        // If restoration fails, just continue - cursor will be at end
                        console.warn('Could not restore cursor position:', e);
                    }
                }
            });
        }
    };

    const handleBlur = () => {
        endInteraction();
        setEditingId(null);
        setCanvasMode(CanvasMode.Preview);
    };

    const handleDelete = (segmentId: string) => {
        deleteCaptionSegment(segmentId);
    };

    // Check if any source has microphone
    const state = useProjectStore.getState();
    const cameraSourceId = state.project.timeline.cameraSourceId;
    const screenSourceId = state.project.timeline.screenSourceId;

    let hasMicrophone = false;

    if (cameraSourceId) {
        const cameraSource = Object.values(state.sources).find((s: any) => s.id === cameraSourceId);
        if (cameraSource && cameraSource.has_microphone) {
            hasMicrophone = true;
        }
    }

    if (!hasMicrophone && screenSourceId) {
        const screenSource = Object.values(state.sources).find((s: any) => s.id === screenSourceId);
        if (screenSource && screenSource.has_microphone) {
            hasMicrophone = true;
        }
    }

    return (
        <div className="space-y-4">
            {/* Notice Section */}
            <p className="text-xs text-text-muted font-light">* Currently only supports English</p>

            {/* Generate/Regenerate Buttons */}
            {!isTranscribing && (
                <div className="flex flex-col gap-2">
                    {!captions ? (
                        <PrimaryButton
                            onClick={handleGenerate}
                            className="w-full"
                        >
                            Generate Captions
                        </PrimaryButton>
                    ) : (
                        <PrimaryButton
                            onClick={handleGenerate}
                            className="w-full"
                        >
                            Regenerate Captions
                        </PrimaryButton>
                    )}
                </div>
            )}

            {/* Caption Settings */}
            {(
                <div className="space-y-3 pb-3 border-b border-border">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-text-main">Visible</label>
                        <Toggle
                            value={settings.visible}
                            onChange={(value) => updateSettings({ captions: { ...settings, visible: value } })}
                        />
                    </div>

                    <Slider
                        value={settings.size}
                        onChange={(value) => updateSettings({ captions: { ...settings, size: value } })}
                        min={32}
                        max={64}
                        label="Size"
                        units="px"
                        showTooltip={true}
                        decimals={0}
                    />

                    <Slider
                        value={settings.width}
                        onChange={(value) => updateSettings({ captions: { ...settings, width: value } })}
                        min={30}
                        max={100}
                        label="Width"
                        units="%"
                        showTooltip={true}
                        decimals={0}
                    />
                </div>
            )}

            {
                isTranscribing && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-text-main">
                            <span>Transcribing audio...</span>
                            <span>{Math.round(transcriptionProgress * 100)}%</span>
                        </div>
                        <div className="w-full h-2 bg-surface-raised rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-300"
                                style={{ width: `${transcriptionProgress * 100}%` }}
                            />
                        </div>
                    </div>
                )
            }

            {
                transcriptionError && (
                    <Notice variant="error">
                        {transcriptionError}
                    </Notice>
                )
            }

            {
                captions && captions.segments.length > 0 && (
                    <div className="space-y-5">
                        <div className="space-y-5">
                            {(() => {
                                return captions.segments.map(segment => {
                                    const range = timeMapper.mapSourceRangeToOutputRange(segment.sourceStartMs, segment.sourceEndMs);
                                    if (!range) return null;
                                    const outputStart = range.start;
                                    const outputEnd = range.end;
                                    const isEditing = editingId === segment.id;

                                    return (
                                        <div key={segment.id} className="flex flex-col w-full">
                                            {/* Capsule bar - time + delete */}
                                            <div className="flex items-center justify-between bg-surface-raised border border-border rounded px-3 py-0.5">
                                                <div className="flex-1 flex items-center justify-center gap-1.5">
                                                    <span className="text-text-main font-mono text-[10px]">
                                                        {formatTime(outputStart)}
                                                    </span>
                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-disabled">
                                                        <line x1="5" y1="12" x2="19" y2="12" />
                                                        <polyline points="12 5 19 12 12 19" />
                                                    </svg>
                                                    <span className="text-text-main font-mono text-[10px]">
                                                        {formatTime(outputEnd)}
                                                    </span>
                                                </div>
                                                <XButton
                                                    onClick={() => handleDelete(segment.id)}
                                                    title="Delete caption"
                                                />
                                            </div>

                                            {/* Caption content */}
                                            <div
                                                className={`group px-3 py-2 rounded bg-surface-overlay font-medium text-xs w-full border transition-colors ${isEditing ? 'ring-active border-border' : 'border-border hover:border-border-hover hover:bg-hover-subtle'}`}
                                            >
                                                <div
                                                    ref={isEditing ? inputRef : null}
                                                    contentEditable={isEditing}
                                                    suppressContentEditableWarning
                                                    onInput={(e) => handleInput(e, segment.id)}
                                                    onKeyDown={handleKeyDown}
                                                    onBlur={handleBlur}
                                                    className={`cursor-text transition-colors ${isEditing ? 'text-text-highlighted' : 'text-text-main group-hover:text-text-highlighted'}`}
                                                    style={{
                                                        lineHeight: 1.4,
                                                        textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                                                        whiteSpace: 'pre-wrap',
                                                        wordBreak: 'break-word',
                                                        outline: 'none'
                                                    }}
                                                    onClick={() => !isEditing && handleEditStart(segment)}
                                                >
                                                    {segment.text}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>
                )
            }
            {/* Modal is rendered here to share access to handleCancel */}
            <ProgressModal
                isOpen={isTranscribing}
                title="Generating Captions"
                projectName={project.name}
                progress={transcriptionProgress}
                statusText="Processing audio..."
                onCancel={handleCancel}
            />
        </div >
    );
}
