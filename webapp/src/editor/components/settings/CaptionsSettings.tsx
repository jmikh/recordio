import { useState, useRef, useEffect, useMemo } from 'react';
import { MdEdit } from 'react-icons/md';
import { RiPaletteLine } from 'react-icons/ri';
import { TbSparkles } from 'react-icons/tb';
import { FaRegClosedCaptioning } from 'react-icons/fa';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useUserStore } from '../../stores/useUserStore';
import type { CaptionSegment } from '../../../types';
import { Slider, CollapsibleCard, Toggle, Dropdown, Tooltip, type PreviewItem, type DropdownOption } from '@shared/components';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { TranscriptionService } from '../../../core/transcription/TranscriptionService';
import { WHISPER_LANGUAGES } from '../../../core/transcription/whisperLanguages';


import { Notice } from '@shared/components';
import { XButton } from '@shared/components';
import { trackCaptionsGenerated } from '../../../core/analytics';
import { useToast } from '../Toast';
import { ColorButton } from './ColorButton';

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

    // Collapsible visibility state
    const showCollapsibleCaptionAI = useUIStore(state => state.showCollapsibleCaptionAI);
    const showCollapsibleCaptionStyle = useUIStore(state => state.showCollapsibleCaptionStyle);
    const showCollapsibleCaptionPosition = useUIStore(state => state.showCollapsibleCaptionPosition);
    const setCollapsibleVisibility = useUIStore(state => state.setCollapsibleVisibility);

    const { batchAction, startInteraction, endInteraction } = useHistoryBatcher();
    const { addToast, updateToast, removeToast } = useToast();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [emptyCaptionsNotice, setEmptyCaptionsNotice] = useState(false);
    const inputRef = useRef<HTMLSpanElement>(null);
    // Snapshot of segment text when editing starts. Rendered as the contentEditable's
    // children during editing so React sees stable content and never overwrites the DOM.
    // This prevents cursor jumps and preserves the browser's native undo stack.
    const editStartTextRef = useRef<string>('');
    const abortControllerRef = useRef<AbortController | null>(null);
    const toastIdRef = useRef<string | null>(null);
    const captionsContainerRef = useRef<HTMLDivElement>(null);
    const [selectedLanguage, setSelectedLanguage] = useState('en');

    const captionSegments = project.timeline.captionSegments;
    const outputWindows = project.timeline.outputWindows;
    const settings = project.settings.captions || { visible: true, captionSize: 1.0, kFontSizePx: 50, kPaddingXPx: 32, kPaddingYPx: 16, kCornerRadiusPx: 12, width: 75, wordHighlight: true, textColor: '#ffffff', backgroundColor: '#000000cc' };
    const hasMicrophone = !!project.microphoneSource;


    // Focus when editing starts
    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editingId]);



    // Exit edit mode when playback starts
    useEffect(() => {
        if (isPlaying && editingId) {
            setEditingId(null);
            endInteraction();
        }
    }, [isPlaying, editingId, endInteraction]);

    // Scroll selected caption into view and auto-enter edit mode when selected from timeline
    useEffect(() => {
        if (!selectedCaptionId) return;
        // Auto-enter edit mode
        if (editingId !== selectedCaptionId) {
            // Snapshot the segment text before editing begins
            const seg = captionSegments?.find(s => s.id === selectedCaptionId);
            if (seg) editStartTextRef.current = seg.text;
            setEditingId(selectedCaptionId);
            startInteraction();
        }
        if (!captionsContainerRef.current) return;
        // Auto-expand the captions card so the segment is visible
        if (!showCollapsibleCaptionPosition) {
            setCollapsibleVisibility('showCollapsibleCaptionPosition', true);
        }
        // Defer scroll to allow DOM to update after expansion
        requestAnimationFrame(() => {
            const el = captionsContainerRef.current?.querySelector(`[data-caption-id="${selectedCaptionId}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }, [selectedCaptionId]);

    // Auto-select caption during playback (only in preview mode with captions panel)
    useEffect(() => {
        if (!isPlaying || canvasMode !== CanvasMode.Preview || selectedSettingsPanel !== 'project') return;
        if (!captionSegments || captionSegments.length === 0) return;

        // Find segment containing current time
        const currentSegment = captionSegments.find(segment =>
            segment.visible && currentTimeMs >= segment.outputStartTimeMs && currentTimeMs <= segment.outputEndTimeMs
        );

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
    }, [isPlaying, currentTimeMs, captionSegments, canvasMode, selectedSettingsPanel, selectedCaptionId, selectCaption]);

    const handleGenerate = async () => {
        const state = useProjectStore.getState();
        const micSource = state.project.microphoneSource;

        if (!micSource?.runtimeUrl) {
            addToast({
                type: 'error',
                title: 'No microphone audio',
                message: 'This recording does not have microphone audio to transcribe.'
            });
            return;
        }


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

            // Fetch microphone audio
            const response = await fetch(micSource.runtimeUrl!);
            if (!response.ok) throw new Error(`Failed to fetch audio: ${response.statusText}`);
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
        const isEditing = editingId === segment.id;

        if (isEditing) {
            // Already editing, do nothing (let contentEditable handle it)
            return;
        }

        // Snapshot segment text before editing begins (see editStartTextRef comment)
        editStartTextRef.current = segment.text;

        // Select, move CTI, and enter edit mode immediately
        selectCaption(segment.id);
        setEditingId(segment.id);
        setCanvasMode(CanvasMode.CaptionEdit);
        setIsPlaying(false);
        startInteraction();

        // Move CTI to the start of the caption
        setCurrentTime(segment.outputStartTimeMs + 1);
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
        let text = e.currentTarget.textContent || '';

        // Enforce 200 character limit
        if (text.length > 200) {
            text = text.substring(0, 200);
            e.currentTarget.textContent = text;

            // Move cursor to end after truncation
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(e.currentTarget);
            range.collapse(false);
            sel?.removeAllRanges();
            sel?.addRange(range);
        }

        // Update the store so the canvas renders the live caption text.
        // Cursor restoration is NOT needed here because editStartTextRef keeps
        // React from overwriting the contentEditable DOM (see render logic).
        batchAction(() => {
            updateCaptionSegment(segmentId, { text });
        });
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
            {/* A.I. Transcription Card */}
            {!isTranscribing && (() => {
                // Derive A.I. status for preview
                const hasGenerated = !!settings.generatedAt;
                const generatedEmpty = hasGenerated && (!settings.baselineCaptions || settings.baselineCaptions.length === 0);
                const generatedSuccess = hasGenerated && !generatedEmpty;

                const aiPreviewItems: PreviewItem[] = generatedSuccess
                    ? [{ type: 'text', content: '✓ Generated' }]
                    : generatedEmpty
                        ? [{ type: 'text', content: 'No speech detected' }]
                        : [];

                // Tooltip: warn on re-transcribe after empty result
                const transcribeTooltip = !hasMicrophone
                    ? 'No microphone detected'
                    : emptyCaptionsNotice
                        ? 'Re-transcribing with the same language will yield the same results. Transcription requires clear, spoken audio.'
                        : '';

                return (
                    <CollapsibleCard
                        title="A.I."
                        icon={<TbSparkles size={16} />}
                        previewItems={aiPreviewItems}
                        isExpanded={showCollapsibleCaptionAI}
                        onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleCaptionAI', v)}
                    >
                        <div className="flex flex-col gap-3">
                            <Tooltip text={transcribeTooltip} className="w-full">
                                <button
                                    onClick={handleGenerate}
                                    disabled={!hasMicrophone}
                                    className="interactive-primary flex items-center justify-center gap-2 w-full"
                                >
                                    Transcribe
                                </button>
                            </Tooltip>

                            {/* Language Dropdown */}
                            <Dropdown
                                options={WHISPER_LANGUAGES.map(lang => ({ value: lang.code, label: lang.label }))}
                                value={selectedLanguage}
                                onChange={setSelectedLanguage}
                            />

                            <p className="subtext">
                                Powered by Whisper — runs locally in your browser. Your audio never leaves your device.
                            </p>

                            {/* Restore Button */}
                            {settings.baselineCaptions && settings.baselineCaptions.length > 0 &&
                                JSON.stringify(captionSegments) !== JSON.stringify(settings.baselineCaptions) && (
                                    <Tooltip text="Restore transcription from the last AI-generated captions" className="w-full">
                                        <button
                                            onClick={() => {
                                                selectCaption(null);
                                                setEditingId(null);
                                                endInteraction();
                                                restoreCaptionsFromBaseline();
                                            }}
                                            className="interactive-base flex items-center justify-center gap-2 w-full"
                                        >
                                            Restore
                                        </button>
                                    </Tooltip>
                                )}
                        </div>
                    </CollapsibleCard>
                );
            })()}

            {/* Style Settings Card - only show when captions exist */}
            {captionSegments && captionSegments.length > 0 && <CollapsibleCard
                title="Style"
                icon={<RiPaletteLine size={16} />}
                previewItems={[
                    {
                        type: 'custom',
                        content: (
                            <div
                                className="w-5 h-5 rounded-full border border-border"
                                style={{ backgroundColor: settings.textColor }}
                            />
                        )
                    },
                    { type: 'text', content: `${(settings.captionSize ?? 1.0).toFixed(1)}×` },
                    { type: 'text', content: `${Math.round(settings.width)}%` }
                ]}
                isExpanded={showCollapsibleCaptionStyle}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleCaptionStyle', v)}
            >
                <div className="flex flex-col gap-4">
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
                        value={settings.captionSize ?? 1.0}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(value) => batchAction(() => updateSettings({ captions: { ...settings, captionSize: value } }))}
                        min={0.5}
                        max={2}
                        label="Size"
                        units="×"
                        showTooltip={true}
                        decimals={1}
                    />

                    <Slider
                        value={settings.width}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(value) => batchAction(() => updateSettings({ captions: { ...settings, width: value } }))}
                        min={30}
                        max={100}
                        label="Width"
                        units="%"
                        showTooltip={true}
                        decimals={0}
                    />

                    <ColorButton
                        title="Text"
                        color={settings.textColor}
                        onChange={(textColor) => batchAction(() => updateSettings({ captions: { ...settings, textColor } }))}
                        onPopoverOpen={startInteraction}
                        onPopoverClose={endInteraction}
                    />

                    <ColorButton
                        title="Background"
                        color={settings.backgroundColor}
                        onChange={(backgroundColor) => batchAction(() => updateSettings({ captions: { ...settings, backgroundColor } }))}
                        onPopoverOpen={startInteraction}
                        onPopoverClose={endInteraction}
                        showAlpha
                    />
                </div>
            </CollapsibleCard>}


            {/* Captions Card - only show when there are segments */}
            <CollapsibleCard
                title="Captions"
                icon={<FaRegClosedCaptioning size={16} />}
                previewItems={[
                    {
                        type: 'text', content: captionSegments && captionSegments.length > 0
                            ? `${captionSegments.length} caption${captionSegments.length !== 1 ? 's' : ''}`
                            : 'None'
                    }
                ]}
                isExpanded={showCollapsibleCaptionPosition}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleCaptionPosition', v)}
            >
                {captionSegments && captionSegments.length > 0 ? (
                    <div ref={captionsContainerRef}>
                        {captionSegments.map(segment => {
                            const outputStart = segment.outputStartTimeMs;
                            const outputEnd = segment.outputEndTimeMs;
                            const isSelected = selectedCaptionId === segment.id;
                            const isEditing = isSelected || editingId === segment.id;

                            return (
                                <span
                                    key={segment.id}
                                    data-caption-id={segment.id}
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
                                        data-placeholder="[empty]"
                                        className={`text-xs transition-all outline-none editable-placeholder ${isEditing
                                            ? 'text-text-highlighted bg-secondary/20 border-b-2 border-secondary'
                                            : 'text-text-muted cursor-pointer hover:text-text-main'
                                            }`}
                                        style={{
                                            lineHeight: 2.2,
                                            padding: isEditing ? '2px 4px' : '2px 0',
                                            borderRadius: isEditing ? '3px' : '0',
                                            minWidth: isEditing ? '20px' : undefined,
                                        }}
                                    >
                                        {/* While editing, render the frozen snapshot so React never
                                           overwrites the DOM — this preserves cursor position and
                                           the browser's native undo stack. Store updates still
                                           happen on each keystroke for live canvas rendering. */}
                                        {isEditing
                                            ? (editStartTextRef.current || '')
                                            : (segment.text || '')
                                        }
                                    </span>
                                    <span> </span>
                                </span>
                            );
                        })}
                    </div>
                ) : (
                    <p className="subtext">
                        Transcribe automatically with AI or add them manually on the captions track in the timeline.
                    </p>
                )}
            </CollapsibleCard>



        </div >
    );
}
