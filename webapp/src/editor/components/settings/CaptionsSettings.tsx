import { useState, useRef, useEffect, useMemo } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useUserStore } from '../../stores/useUserStore';
import type { CaptionSegment } from '../../../types';
import { Slider } from '@shared/components';
import { Toggle } from '@shared/components';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { TranscriptionService } from '../../../core/transcription/TranscriptionService';
import { TimeMapper } from '../../../core/mappers/timeMapper';
import { PrimaryButton } from '@shared/components';
import { Notice } from '@shared/components';
import { XButton } from '@shared/components';
import { trackCaptionsGenerated } from '../../../core/analytics';
import { useToast } from '../Toast';

/**
 * Settings panel for managing captions.
 */
export function CaptionsSettings() {
    const project = useProjectStore(state => state.project);
    const updateSettings = useProjectStore(state => state.updateSettings);
    const updateCaptionSegment = useProjectStore(state => state.updateCaptionSegment);
    const deleteCaptionSegment = useProjectStore(state => state.deleteCaptionSegment);
    const setCaptionSegments = useProjectStore(state => state.setCaptionSegments);

    // UI Store actions
    const setCanvasMode = useUIStore(state => state.setCanvasMode);
    const setIsPlaying = useUIStore(state => state.setIsPlaying);
    const setCurrentTime = useUIStore(state => state.setCurrentTime);

    const { batchAction, startInteraction, endInteraction } = useHistoryBatcher();
    const { addToast, updateToast, removeToast } = useToast();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [emptyCaptionsNotice, setEmptyCaptionsNotice] = useState(false);
    const inputRef = useRef<HTMLSpanElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const toastIdRef = useRef<string | null>(null);

    const captionSegments = project.timeline.captionSegments;
    const outputWindows = project.timeline.outputWindows;
    const settings = project.settings.captions || { visible: true, size: 24, width: 75, wordHighlight: true };

    // Create TimeMapper for source→output time conversion
    const timeMapper = useMemo(() => new TimeMapper(outputWindows), [outputWindows]);

    // Focus when editing starts
    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editingId]);

    const handleGenerate = async () => {
        const state = useProjectStore.getState();
        const { cameraSource, screenSource } = state.project;

        // Determine which source has microphone
        let sourceToTranscribe: typeof cameraSource | typeof screenSource | null = null;
        let sourceName = '';

        // Check camera source first
        if (cameraSource?.has_microphone) {
            sourceToTranscribe = cameraSource;
            sourceName = 'camera';
        }

        // Fall back to screen source if camera doesn't have microphone
        if (!sourceToTranscribe && screenSource?.has_microphone) {
            sourceToTranscribe = screenSource;
            sourceName = 'screen';
        }


        // If no source has microphone, return early (this shouldn't happen as panel is hidden)
        if (!sourceToTranscribe) {
            console.error('[CaptionsSettings] No microphone audio available for transcription');
            return;
        }

        console.log(`[CaptionsSettings] Using ${sourceName} source for transcription`);

        try {
            // Pause playback
            setIsPlaying(false);
            setIsTranscribing(true);

            // Setup AbortController
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();
            const signal = abortControllerRef.current.signal;

            // Show progress toast
            const toastId = addToast({
                type: 'progress',
                title: 'Generating Captions',
                message: 'Loading audio...',
                progress: 0,
                onCancel: handleCancel
            });
            toastIdRef.current = toastId;

            // Fetch source video
            const response = await fetch(sourceToTranscribe.runtimeUrl!);
            if (!response.ok) throw new Error(`Failed to fetch video: ${response.statusText}`);
            const videoBlob = await response.blob();

            if (signal.aborted) throw new Error('Aborted');

            updateToast(toastId, { progress: 0.1, message: 'Transcribing audio...' });

            // Run transcription on entire audio (runs in Web Worker)
            const transcriptionService = TranscriptionService.getInstance();
            const transcriptionData = await transcriptionService.transcribe(
                videoBlob,
                (progress: number) => {
                    // Scale progress: 10% for loading + 90% for transcription
                    const scaledProgress = 0.1 + (progress * 0.9);
                    updateToast(toastId, { progress: scaledProgress });
                },
                signal
            );

            // Success
            setCaptionSegments(transcriptionData);

            // Track caption generation
            const { isAuthenticated, isPro } = useUserStore.getState();
            trackCaptionsGenerated({
                segment_count: transcriptionData.length,
                is_authenticated: isAuthenticated,
                is_pro: isPro,
            });

            // Show success toast
            updateToast(toastId, {
                type: 'success',
                title: 'Captions Generated',
                message: `${transcriptionData.length} caption${transcriptionData.length !== 1 ? 's' : ''} created`
            });

            // Check if captions are empty (no audible speech detected)
            if (transcriptionData.length === 0) {
                setEmptyCaptionsNotice(true);
            } else {
                setEmptyCaptionsNotice(false);
            }

        } catch (error: any) {
            if (error.message === 'Aborted') {
                console.log('[CaptionsSettings] Transcription cancelled');
                if (toastIdRef.current) {
                    removeToast(toastIdRef.current);
                }
                return;
            }
            console.error('[CaptionsSettings] Failed to generate transcription:', error);
            setEmptyCaptionsNotice(false);

            // Show error toast
            if (toastIdRef.current) {
                updateToast(toastIdRef.current, {
                    type: 'error',
                    title: 'Caption Generation Failed',
                    message: 'Please try again'
                });
            }
        } finally {
            setIsTranscribing(false);
            toastIdRef.current = null;
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
        TranscriptionService.getInstance().abort();
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

        // Move CTI to the start of the caption (convert source time to output time)
        const sourceToOutputTime = timeMapper.mapSourceToOutputTime(segment.sourceStartMs);
        if (sourceToOutputTime !== -1) {
            setCurrentTime(sourceToOutputTime);
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

    const handleInput = (e: React.FormEvent<HTMLSpanElement>, segmentId: string) => {
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

    return (
        <div className="space-y-4">
            {/* Notice Section */}
            <p className="text-xs text-text-muted font-light">* Currently only supports English</p>

            {/* Generate/Regenerate Buttons */}
            {!isTranscribing && (
                <div className="flex flex-col gap-2">
                    {captionSegments.length === 0 ? (
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

                    <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-text-main">Word Highlight</label>
                        <Toggle
                            value={settings.wordHighlight ?? true}
                            onChange={(value) => updateSettings({ captions: { ...settings, wordHighlight: value } })}
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


            {emptyCaptionsNotice && (
                <Notice variant="info">
                    No audible speech was detected in the audio. Captions require clear, spoken English to generate.
                </Notice>
            )}

            {
                captionSegments && captionSegments.length > 0 && (
                    <div
                        className="bg-surface-overlay rounded-lg p-4"
                        style={{ paddingTop: '28px' }}
                    >
                        <div>
                            {captionSegments.map(segment => {
                                // Convert source time to output time for display
                                const outputRange = timeMapper.mapSourceRangeToOutputRange(segment.sourceStartMs, segment.sourceEndMs);
                                const outputStart = outputRange?.start ?? segment.sourceStartMs;
                                const outputEnd = outputRange?.end ?? segment.sourceEndMs;
                                const isEditing = editingId === segment.id;

                                return (
                                    <span
                                        key={segment.id}
                                        onClick={() => !isEditing && handleEditStart(segment)}
                                        className="relative inline"
                                    >
                                        {/* Floating timestamp pill - shows on selection */}
                                        {isEditing && (
                                            <span
                                                className="absolute font-mono text-[9px] text-primary-highlighted bg-surface-raised flex items-center gap-1.5 whitespace-nowrap z-10 shadow-float"
                                                style={{
                                                    top: '-24px',
                                                    left: 0,
                                                    padding: '3px 4px 3px 8px',
                                                    borderRadius: '4px'
                                                }}
                                            >
                                                <span>{formatTime(outputStart)} → {formatTime(outputEnd)}</span>
                                                <XButton
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDelete(segment.id);
                                                    }}
                                                    title="Delete caption"
                                                />
                                            </span>
                                        )}

                                        {/* Caption text - inline editable */}
                                        <span
                                            ref={isEditing ? inputRef : null}
                                            contentEditable={isEditing}
                                            suppressContentEditableWarning
                                            onInput={(e) => handleInput(e, segment.id)}
                                            onKeyDown={handleKeyDown}
                                            onBlur={handleBlur}
                                            className={`text-xs transition-all outline-none ${isEditing
                                                ? 'text-text-highlighted bg-primary/20 border-b-2 border-primary'
                                                : 'text-text-muted cursor-pointer hover:text-text-main'
                                                }`}
                                            style={{
                                                lineHeight: 2.2,
                                                padding: isEditing ? '2px 4px' : '2px 0',
                                                borderRadius: '3px',
                                            }}
                                        >
                                            {segment.text}
                                        </span>
                                        <span> </span>
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                )
            }

        </div >
    );
}
