import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { MdInfoOutline, MdEdit, MdKeyboardArrowDown } from 'react-icons/md';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useUserStore } from '../../stores/useUserStore';
import type { CaptionSegment } from '../../../types';
import { Slider, DefaultButton } from '@shared/components';
import { Toggle } from '@shared/components';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { TranscriptionService } from '../../../core/transcription/TranscriptionService';
import { WHISPER_LANGUAGES } from '../../../core/transcription/whisperLanguages';
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
    const restoreCaptionsFromBaseline = useProjectStore(state => state.restoreCaptionsFromBaseline);

    // UI Store actions
    const canvasMode = useUIStore(state => state.canvasMode);
    const setCanvasMode = useUIStore(state => state.setCanvasMode);
    const isPlaying = useUIStore(state => state.isPlaying);
    const setIsPlaying = useUIStore(state => state.setIsPlaying);
    const currentTimeMs = useUIStore(state => state.currentTimeMs);
    const setCurrentTime = useUIStore(state => state.setCurrentTime);
    const selectedCaptionId = useUIStore(state => state.selectedCaptionId);
    const selectCaption = useUIStore(state => state.selectCaption);
    const selectedSettingsPanel = useUIStore(state => state.selectedSettingsPanel);

    const { batchAction, startInteraction, endInteraction } = useHistoryBatcher();
    const { addToast, updateToast, removeToast } = useToast();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [emptyCaptionsNotice, setEmptyCaptionsNotice] = useState(false);
    const inputRef = useRef<HTMLSpanElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const toastIdRef = useRef<string | null>(null);
    const infoIconRef = useRef<HTMLSpanElement>(null);
    const [showInfoTooltip, setShowInfoTooltip] = useState(false);
    const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });
    const [selectedLanguage, setSelectedLanguage] = useState('en');
    const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
    const languageDropdownRef = useRef<HTMLDivElement>(null);

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

    // Close language dropdown on click outside
    useEffect(() => {
        if (!showLanguageDropdown) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (languageDropdownRef.current && !languageDropdownRef.current.contains(e.target as Node)) {
                setShowLanguageDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showLanguageDropdown]);

    // Exit edit mode when playback starts
    useEffect(() => {
        if (isPlaying && editingId) {
            setEditingId(null);
            endInteraction();
        }
    }, [isPlaying, editingId, endInteraction]);

    // Auto-select caption during playback (only in preview mode with captions panel)
    useEffect(() => {
        if (!isPlaying || canvasMode !== CanvasMode.Preview || selectedSettingsPanel !== 'project') return;
        if (!captionSegments || captionSegments.length === 0) return;

        // Find segment containing current time
        const currentSegment = captionSegments.find(segment => {
            const outputRange = timeMapper.mapSourceRangeToOutputRange(segment.sourceStartMs, segment.sourceEndMs);
            if (!outputRange) return false;
            return currentTimeMs >= outputRange.start && currentTimeMs <= outputRange.end;
        });

        if (currentSegment) {
            if (selectedCaptionId !== currentSegment.id) {
                selectCaption(currentSegment.id);
            }
        } else {
            // Deselect when not in any segment
            if (selectedCaptionId) {
                selectCaption(null);
            }
        }
    }, [isPlaying, currentTimeMs, captionSegments, timeMapper, canvasMode, selectedSettingsPanel, selectedCaptionId, selectCaption]);

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
                signal,
                selectedLanguage
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

    // Handle clicking on a caption segment
    const handleSegmentClick = (segment: CaptionSegment) => {
        const isSelected = selectedCaptionId === segment.id;
        const isEditing = editingId === segment.id;

        if (isEditing) {
            // Already editing, do nothing (let contentEditable handle it)
            return;
        }

        if (isSelected) {
            // Second click on selected segment → enter edit mode
            setEditingId(segment.id);
            setCanvasMode(CanvasMode.CaptionEdit);
            setIsPlaying(false);
            startInteraction();
        } else {
            // First click → select and move CTI (don't pause playback)
            selectCaption(segment.id);

            // Move CTI to the start of the caption (use output range + 1 to ensure we're inside)
            const outputRange = timeMapper.mapSourceRangeToOutputRange(segment.sourceStartMs, segment.sourceEndMs);
            if (outputRange) {
                setCurrentTime(outputRange.start + 1);
            }
        }
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
        if (editingId) {
            setEditingId(null);
            setCanvasMode(CanvasMode.Preview);
            endInteraction();
            // Keep selection when exiting edit mode
        }
    };

    const handleDelete = (segmentId: string) => {
        deleteCaptionSegment(segmentId);
    };

    return (
        <div className="space-y-4">
            {/* Transcribe/Restore Buttons */}
            {!isTranscribing && (
                <PrimaryButton
                    onClick={handleGenerate}
                    className="w-full flex items-center justify-center gap-2"
                >
                    Transcribe
                    <span
                        ref={infoIconRef}
                        className="w-4 h-4 flex items-center justify-center rounded-full bg-black/30"
                        onMouseEnter={() => {
                            if (infoIconRef.current) {
                                const rect = infoIconRef.current.getBoundingClientRect();
                                setTooltipPosition({
                                    left: rect.left + rect.width / 2,
                                    top: rect.bottom + 8
                                });
                            }
                            setShowInfoTooltip(true);
                        }}
                        onMouseLeave={() => setShowInfoTooltip(false)}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <MdInfoOutline size={10} className="text-white/80" />
                    </span>
                </PrimaryButton>
            )}

            {/* Language Dropdown */}
            {!isTranscribing && (
                <div ref={languageDropdownRef} className="relative">
                    <button
                        onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-surface-overlay border border-border rounded-md text-sm text-text-main hover:border-border-hover transition-colors"
                    >
                        <span>{WHISPER_LANGUAGES.find(l => l.code === selectedLanguage)?.label || 'English'}</span>
                        <MdKeyboardArrowDown
                            size={18}
                            className={`text-text-muted transition-transform ${showLanguageDropdown ? 'rotate-180' : ''}`}
                        />
                    </button>
                    {showLanguageDropdown && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-surface-overlay border border-border rounded-md shadow-float z-[var(--z-index-dropdown)] max-h-[200px] overflow-y-auto">
                            {WHISPER_LANGUAGES.map((lang) => (
                                <button
                                    key={lang.code}
                                    onClick={() => {
                                        setSelectedLanguage(lang.code);
                                        setShowLanguageDropdown(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${selectedLanguage === lang.code
                                        ? 'bg-primary/20 text-primary-highlighted'
                                        : 'text-text-main hover:bg-state-hover'
                                        }`}
                                >
                                    {lang.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Restore Transcript Button */}
            {!isTranscribing && settings.baselineCaptions?.length &&
                JSON.stringify(captionSegments) !== JSON.stringify(settings.baselineCaptions) && (
                    <DefaultButton
                        onClick={() => restoreCaptionsFromBaseline()}
                        className="w-full"
                    >
                        Restore Transcript
                    </DefaultButton>
                )}

            {/* Caption Settings */}
            {(
                <div className="space-y-3 pb-3 border-b border-border">
                    <Toggle
                        label="Visible"
                        value={settings.visible}
                        onChange={(value) => updateSettings({ captions: { ...settings, visible: value } })}
                    />

                    <Toggle
                        label="Word Highlight"
                        value={settings.wordHighlight ?? true}
                        onChange={(value) => updateSettings({ captions: { ...settings, wordHighlight: value } })}
                    />

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
                                const isSelected = selectedCaptionId === segment.id;

                                return (
                                    <span
                                        key={segment.id}
                                        onClick={() => handleSegmentClick(segment)}
                                        className="relative inline"
                                    >
                                        {/* Caption text - inline editable */}
                                        <span
                                            ref={isEditing ? inputRef : null}
                                            contentEditable={isEditing}
                                            suppressContentEditableWarning
                                            onInput={(e) => handleInput(e, segment.id)}
                                            onKeyDown={handleKeyDown}
                                            onBlur={handleBlur}
                                            className={`text-xs transition-all outline-none ${isEditing
                                                ? 'text-text-highlighted bg-secondary/20 border-b-2 border-secondary'
                                                : isSelected
                                                    ? 'text-text-highlighted border-b border-primary cursor-text'
                                                    : 'text-text-muted cursor-pointer hover:text-text-main'
                                                }`}
                                            style={{
                                                lineHeight: 2.2,
                                                padding: isEditing ? '2px 4px' : '2px 0',
                                                borderRadius: isEditing ? '3px' : '0',
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

            {/* Info tooltip - rendered via portal */}
            {showInfoTooltip && createPortal(
                <div
                    className="fixed z-[999999] bg-surface-overlay border border-border rounded-md shadow-float px-3 py-2 max-w-[240px] text-xs text-text-main"
                    style={{
                        left: tooltipPosition.left,
                        top: tooltipPosition.top,
                        transform: 'translateX(-50%)'
                    }}
                    onMouseEnter={() => setShowInfoTooltip(true)}
                    onMouseLeave={() => setShowInfoTooltip(false)}
                >
                    Transcription runs entirely in your browser using local AI. Your audio never leaves your device.
                </div>,
                document.body
            )}

        </div >
    );
}
