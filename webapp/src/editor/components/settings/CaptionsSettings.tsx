import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MdEdit, MdVisibilityOff, MdVisibility } from 'react-icons/md';
import { FiScissors } from 'react-icons/fi';
import { RiPaletteLine } from 'react-icons/ri';
import { TbSparkles, TbCopy, TbDownload } from 'react-icons/tb';
import { LuCaptions } from 'react-icons/lu';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useUserStore } from '../../stores/useUserStore';
import { Slider, CollapsibleCard, Toggle, Tooltip, Button, MultiToggle, ProBadge, type PreviewItem } from '@shared/components';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { TranscriptionService } from '../../../core/transcription/TranscriptionService';
import { CloudTranscriptionService, RateLimitError } from '../../../core/transcription/CloudTranscriptionService';

import { UpgradeModal } from '../header/UpgradeModal';
import { AuthModal } from '../header/AuthModal';

import { trackGenerateCaptions } from '../../../core/analytics';
import { useToast } from '../Toast';
import { ColorButton } from './ColorButton';

type TranscriptionEngine = 'local' | 'openai';

/** Selection state for words in captions. */
interface WordSelection {
    segmentId: string;
    wordIds: string[];
    anchorRect: DOMRect;
    isEditing: boolean;
}

export function CaptionsSettings() {
    const project = useProjectStore(state => state.project);
    const updateSettings = useProjectStore(state => state.updateSettings);
    const setCaptionSegments = useProjectStore(state => state.setCaptionSegments);
    const updateWord = useProjectStore(state => state.updateWord);
    const cutOutputRange = useProjectStore(state => state.cutOutputRange);

    // UI Store actions
    const setIsPlaying = useUIStore(state => state.setIsPlaying);
    const setCurrentTime = useUIStore(state => state.setCurrentTime);
    // Collapsible visibility state
    const showCollapsibleCaptionAI = useUIStore(state => state.showCollapsibleCaptionAI);
    const showCollapsibleCaptionStyle = useUIStore(state => state.showCollapsibleCaptionStyle);
    const showCollapsibleCaptionPosition = useUIStore(state => state.showCollapsibleCaptionPosition);
    const setCollapsibleVisibility = useUIStore(state => state.setCollapsibleVisibility);

    const isTranscribing = useProjectStore(state => state.isTranscribing);
    const transcriptionPhase = useProjectStore(state => state.transcriptionPhase);
    const modelDownloadProgress = useProjectStore(state => state.modelDownloadProgress);
    const setTranscriptionState = useProjectStore(state => state.setTranscriptionState);

    const { batchAction, startInteraction, endInteraction } = useHistoryBatcher();
    const { addToast } = useToast();
    const hideCloudTranscription = false; // TODO: remove after per-user limits are live
    const [engine, setEngine] = useState<TranscriptionEngine>('local');
    const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const captionsCardRef = useRef<HTMLDivElement>(null);

    // Word selection state
    const [selection, setSelection] = useState<WordSelection | null>(null);
    const [editText, setEditText] = useState('');
    const popoverRef = useRef<HTMLDivElement>(null);
    const editInputRef = useRef<HTMLInputElement>(null);


    const captionSegments = project.timeline.captionSegments;
    const settings = project.settings.captions || { enabled: true, captionSize: 1.0, kFontSizePx: 50, kPaddingXPx: 32, kPaddingYPx: 16, kCornerRadiusPx: 12, width: 75, wordHighlight: true, textColor: '#ffffff', backgroundColor: '#000000cc' };
    const hasMicrophone = !!project.microphoneSource;

    // Close selection on click outside (words call stopPropagation so this won't fire for them)
    useEffect(() => {
        if (!selection) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current?.contains(e.target as Node)) return;
            setSelection(null);
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [selection]);

    // Focus edit input when entering edit mode
    useEffect(() => {
        if (selection?.isEditing && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [selection?.isEditing]);

    // Escape to deselect
    useEffect(() => {
        if (!selection) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSelection(null);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [selection]);

    // Sync caption word selection → timeline highlight range
    useEffect(() => {
        if (!selection) return;

        const seg = captionSegments?.find(s => s.id === selection.segmentId);
        if (!seg) return;

        const selectedWords = seg.words.filter(w => selection.wordIds.includes(w.id) && w.visible);
        if (selectedWords.length === 0) return;

        const startMs = Math.min(...selectedWords.map(w => w.outputStartTimeMs));
        const endMs = Math.max(...selectedWords.map(w => w.outputEndTimeMs));

        useUIStore.getState().setHighlightRange({ startMs, endMs });
    }, [selection, captionSegments]);

    // Clear caption word selection when highlight range is cleared externally
    // (e.g. user clicks on ruler, selects a zoom, presses Escape on timeline)
    useEffect(() => {
        if (!selection) return;
        let prevRange = useUIStore.getState().highlightRange;
        const unsub = useUIStore.subscribe((state) => {
            if (prevRange && !state.highlightRange) {
                setSelection(null);
            }
            prevRange = state.highlightRange;
        });
        return unsub;
    }, [selection]);

    /** Build visible transcript text from segments (shared by copy & download). */
    const getVisibleTranscriptSegments = () => {
        if (!captionSegments) return [];
        return captionSegments
            .filter(s => s.visible)
            .map(s => ({
                start: s.outputStartTimeMs,
                end: s.outputEndTimeMs,
                text: s.words.filter(w => w.visible && !w.hidden).map(w => w.word).join(' '),
            }))
            .filter(s => s.text.length > 0);
    };

    const formatSubtitleTime = (ms: number, separator: string) => {
        const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
        const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
        const ms3 = String(Math.floor(ms % 1000)).padStart(3, '0');
        return `${h}:${m}:${s}${separator}${ms3}`;
    };

    const downloadFile = (content: string, filename: string, mime: string) => {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadSrt = () => {
        const segments = getVisibleTranscriptSegments();
        const srt = segments.map((s, i) =>
            `${i + 1}\n${formatSubtitleTime(s.start, ',')} --> ${formatSubtitleTime(s.end, ',')}\n${s.text}`
        ).join('\n\n');
        downloadFile(srt, `${project.name || 'captions'}.srt`, 'text/srt');
    };

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

        // Pro gate for OpenAI engine
        if (engine === 'openai') {
            const { isAuthenticated, hasProAccess } = useUserStore.getState();
            if (!isAuthenticated) {
                setIsAuthModalOpen(true);
                return;
            }
            if (!hasProAccess()) {
                setIsUpgradeModalOpen(true);
                return;
            }
        }

        try {
            // Pause playback
            setIsPlaying(false);
            setTranscriptionState({ isTranscribing: true, transcriptionPhase: 'generating', modelDownloadProgress: 0 });

            // Setup AbortController
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();
            const signal = abortControllerRef.current.signal;

            // Fetch microphone audio
            const response = await fetch(micSource.runtimeUrl!);
            if (!response.ok) throw new Error(`Failed to fetch audio: ${response.statusText}`);
            const micBlob = await response.blob();

            if (signal.aborted) throw new Error('Aborted');

            let transcriptionData;

            if (engine === 'openai') {
                setTranscriptionState({ transcriptionPhase: 'generating' });
                transcriptionData = await CloudTranscriptionService.transcribe(
                    micBlob,
                    'auto',
                    () => {},
                    signal,
                );
            } else {
                const transcriptionService = TranscriptionService.getInstance();
                transcriptionData = await transcriptionService.transcribe(
                    micBlob,
                    () => {},
                    signal,
                    (phase, progress) => {
                        setTranscriptionState({
                            transcriptionPhase: phase,
                            ...(phase === 'downloading' && progress !== undefined ? { modelDownloadProgress: progress } : {}),
                        });
                    },
                );
            }

            // Store result (even if empty, so button state updates)
            setCaptionSegments(transcriptionData, {
                engine,
                language: engine === 'openai' ? 'auto' : 'en',
            });

            trackGenerateCaptions({
                segment_count: transcriptionData.length,
                transcription_method: engine === 'openai' ? 'cloud' : 'local',
                success: true,
            });

            if (transcriptionData.length === 0) {
                addToast({
                    type: 'error',
                    title: 'No Speech Detected',
                    message: engine === 'local'
                        ? 'Local models running in the browser need clear speech to work well. Try the OpenAI model for better results.'
                        : 'Transcription completed but no speech was detected in the audio.',
                });
            } else {
                addToast({
                    type: 'success',
                    title: 'Captions Generated',
                    message: `${transcriptionData.length} caption${transcriptionData.length !== 1 ? 's' : ''} created`
                });

                // Expand captions card and scroll it into view
                setCollapsibleVisibility('showCollapsibleCaptionPosition', true);
                requestAnimationFrame(() => {
                    captionsCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
            }

        } catch (error: any) {
            if (error.message === 'Aborted') return;

            // Handle rate limit errors from cloud transcription
            if (error instanceof RateLimitError) {
                const resetDate = new Date(error.resetsAt);
                const resetStr = resetDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                addToast({
                    type: 'error',
                    title: 'Transcription Limit Reached',
                    message: `${error.cycleMinutesUsed.toFixed(0)} of ${error.cycleMinutesLimit} minutes used. Resets ${resetStr}.`
                });
                return;
            }

            console.error('[CaptionsSettings] Failed to generate transcription:', error);

            trackGenerateCaptions({
                segment_count: 0,
                transcription_method: engine === 'openai' ? 'cloud' : 'local',
                success: false,
                error: error.message,
            });

            addToast({
                type: 'error',
                title: 'Caption Generation Failed',
                message: 'Please try again'
            });
        } finally {
            setTranscriptionState({ isTranscribing: false, transcriptionPhase: 'idle', modelDownloadProgress: 0 });
            if (abortControllerRef.current?.signal.aborted) {
                abortControllerRef.current = null;
            }
        }
    };


    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}:${String(secs).padStart(2, '0')}`;
    };

    // Handle clicking on a word — calendar-style selection
    const handleWordClick = (segmentId: string, wordId: string, e: React.MouseEvent<HTMLSpanElement>) => {
        e.stopPropagation();
        const rect = (e.target as HTMLElement).getBoundingClientRect();

        setSelection(prev => {
            // No existing selection, or clicking in a different segment → select single word
            if (!prev || prev.segmentId !== segmentId) {
                return { segmentId, wordIds: [wordId], anchorRect: rect, isEditing: false };
            }

            const isSingle = prev.wordIds.length === 1;
            const isRange = prev.wordIds.length > 1;

            // Single word selected
            if (isSingle) {
                // Clicking the same word → deselect
                if (prev.wordIds[0] === wordId) return null;

                // Clicking a different word in the same segment → create range
                const seg = captionSegments?.find(s => s.id === segmentId);
                if (!seg) return { segmentId, wordIds: [wordId], anchorRect: rect, isEditing: false };

                const wordIndices = [prev.wordIds[0], wordId].map(
                    id => seg.words.findIndex(w => w.id === id)
                );
                const minIdx = Math.min(...wordIndices);
                const maxIdx = Math.max(...wordIndices);
                const rangeIds = seg.words.slice(minIdx, maxIdx + 1).map(w => w.id);

                return { segmentId, wordIds: rangeIds, anchorRect: prev.anchorRect, isEditing: false };
            }

            // Range selected → clicking any word resets to single
            if (isRange) {
                return { segmentId, wordIds: [wordId], anchorRect: rect, isEditing: false };
            }

            return { segmentId, wordIds: [wordId], anchorRect: rect, isEditing: false };
        });

        // Move CTI to the word's output time
        const seg = captionSegments?.find(s => s.id === segmentId);
        const word = seg?.words.find(w => w.id === wordId);
        if (word?.visible) {
            setIsPlaying(false);
            setCurrentTime(word.outputStartTimeMs + 1);
        }

        // Set edit text for single-word editing
        if (word) setEditText(word.word);
    };

    const handleEditSave = () => {
        if (!selection || selection.wordIds.length !== 1 || !editText.trim()) return;
        updateWord(selection.segmentId, selection.wordIds[0], { word: editText.trim() });
        setSelection(null);
    };

    const handleHideSelected = () => {
        if (!selection) return;
        for (const wId of selection.wordIds) {
            updateWord(selection.segmentId, wId, { hidden: true });
        }
        setSelection(null);
    };

    const handleShowSelected = () => {
        if (!selection) return;
        for (const wId of selection.wordIds) {
            updateWord(selection.segmentId, wId, { hidden: false });
        }
        setSelection(null);
    };

    const handleCutSelected = () => {
        const range = useUIStore.getState().highlightRange;
        if (!range) return;
        cutOutputRange(range.startMs, range.endMs);
        useUIStore.getState().setHighlightRange(null);
        setSelection(null);
    };

    return (
        <div className="space-y-4">
            {/* A.I. Transcription Card */}
            {(() => {
                const source = settings.transcriptionSource;

                // Disable when the same engine was already used
                const alreadyGenerated = !!source && source.engine === engine;

                // Preview pill when collapsed
                const aiPreviewItems: PreviewItem[] = source
                    ? [{ type: 'text', content: source.engine === 'openai' ? 'OpenAI' : 'Local' }]
                    : [];

                const buttonDisabled = !hasMicrophone || alreadyGenerated || isTranscribing;
                const emptyCaptions = alreadyGenerated && (!captionSegments || captionSegments.length === 0);
                const buttonLabel = isTranscribing
                    ? (transcriptionPhase === 'downloading' ? 'Downloading Model...' : 'Generating...')
                    : alreadyGenerated
                        ? (emptyCaptions ? 'No Speech Detected' : 'Captions Generated')
                        : source
                            ? 'Re-generate Captions'
                            : 'Generate Captions';

                return (
                    <CollapsibleCard
                        title="A.I."
                        icon={<TbSparkles className="icon-md" />}
                        previewItems={aiPreviewItems}
                        isExpanded={showCollapsibleCaptionAI}
                        onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleCaptionAI', v)}
                    >
                        <div className="flex flex-col gap-3">
                            {/* Engine Toggle */}
                            {!hideCloudTranscription && (
                                <MultiToggle
                                    options={[
                                        { value: 'local' as TranscriptionEngine, label: 'Local' },
                                        { value: 'openai' as TranscriptionEngine, label: 'OpenAI', icon: <ProBadge /> },
                                    ]}
                                    value={engine}
                                    onChange={setEngine}
                                />
                            )}

                            <Tooltip text={!hasMicrophone ? 'No microphone detected' : ''} className="w-full">
                                <Button
                                    variant="primary"
                                    onClick={handleGenerate}
                                    disabled={buttonDisabled}
                                    fullWidth
                                >
                                    {isTranscribing && (
                                        <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    )}
                                    {buttonLabel}
                                </Button>
                            </Tooltip>

                            {/* Model download progress bar */}
                            {isTranscribing && transcriptionPhase === 'downloading' && (
                                <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                                    <div
                                        className="bg-secondary h-full rounded-full transition-all duration-300"
                                        style={{ width: `${Math.round(modelDownloadProgress * 100)}%` }}
                                    />
                                </div>
                            )}

                            <p className="subtext">
                                {engine === 'openai'
                                    ? 'Powered by OpenAI Whisper — highest accuracy with multi-language support.'
                                    : hideCloudTranscription
                                        ? 'Runs locally in your browser — no data leaves your device.'
                                        : 'Runs locally in your browser. For better accuracy and faster transcription and multi-language support, use OpenAI.'
                                }
                            </p>
                        </div>
                    </CollapsibleCard>
                );
            })()}

            {/* Captions Card */}
            <div ref={captionsCardRef}>
            <CollapsibleCard
                title="Captions"
                icon={<LuCaptions className="icon-md" />}
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
                    <div className="flex flex-col gap-1.5">
                        <div className="flex gap-1.5 mb-1.5">
                            <Tooltip text="Copy without timestamps" className="flex-1">
                                <Button
                                    variant="base"
                                    size="sm"
                                    fullWidth
                                    icon={TbCopy}
                                    onClick={() => {
                                        const text = getVisibleTranscriptSegments().map(s => s.text).join('\n');
                                        navigator.clipboard.writeText(text);
                                        addToast({ type: 'success', title: 'Transcript copied' });
                                    }}
                                >
                                    Copy
                                </Button>
                            </Tooltip>
                            <Tooltip text="Download in SRT format" className="flex-1">
                                <Button
                                    variant="base"
                                    size="sm"
                                    fullWidth
                                    icon={TbDownload}
                                    onClick={handleDownloadSrt}
                                >
                                    Download
                                </Button>
                            </Tooltip>
                        </div>
                        {captionSegments.filter(s => s.visible).map(segment => (
                            <div key={segment.id} className="flex items-start gap-1">
                                {/* Timestamp */}
                                <span className="text-xs text-text-disabled tabular-nums shrink-0 select-none pt-0.5" style={{ minWidth: '3.2em' }}>
                                    {formatTime(segment.outputStartTimeMs)}
                                </span>

                                {/* Words rendered inline — hide words fully cut from output */}
                                <span className="text-xs flex-1 leading-relaxed">
                                    {segment.words.filter(w => w.visible).map((word, wordIdx) => {
                                        const isHidden = !!word.hidden;
                                        const isSelected = selection?.segmentId === segment.id && selection.wordIds.includes(word.id);

                                        return (
                                            <span
                                                key={word.id}
                                                onClick={(e) => handleWordClick(segment.id, word.id, e)}
                                                className={[
                                                    'rounded-[3px] transition-colors cursor-pointer',
                                                    !isHidden && !isSelected && 'text-text-muted hover:text-text-highlighted hover:bg-white/10',
                                                    isHidden && !isSelected && 'text-text-disabled line-through hover:text-text-muted hover:bg-white/10',
                                                    isSelected && 'bg-secondary/20 text-secondary',
                                                    isSelected && isHidden && 'line-through',
                                                ].filter(Boolean).join(' ')}
                                            >
                                                {wordIdx > 0 && ' '}{word.word}
                                            </span>
                                        );
                                    })}
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="subtext">
                        Transcribe automatically with AI to generate captions.
                    </p>
                )}
            </CollapsibleCard>
            </div>

            {/* Style Settings Card - only show when captions exist */}
            {captionSegments && captionSegments.length > 0 && <CollapsibleCard
                title="Style"
                icon={<RiPaletteLine className="icon-md" />}
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
                        label="Hide"
                        value={!settings.enabled}
                        onChange={(value) => updateSettings({ captions: { ...settings, enabled: !value } })}
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

            {/* Word Action Popover — positioned above the first selected word */}
            {selection && createPortal(
                <div
                    ref={popoverRef}
                    onClick={(e) => e.stopPropagation()}
                    className={`bg-surface-raised border border-border ${selection.isEditing ? 'rounded-lg' : 'rounded-full'} shadow-float flex items-center gap-0.5 px-1 py-1`}
                    style={{
                        position: 'fixed',
                        bottom: window.innerHeight - selection.anchorRect.top + 4,
                        left: selection.anchorRect.left,
                        zIndex: 9999,
                    }}
                >
                    {selection.isEditing ? (
                        <div className="flex items-center gap-1 px-0.5">
                            <input
                                ref={editInputRef}
                                type="text"
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleEditSave();
                                    if (e.key === 'Escape') setSelection(null);
                                }}
                                className="bg-surface text-text-highlighted text-xs px-2 py-1 rounded border border-border outline-none focus:border-secondary"
                                style={{ width: `${Math.max(editText.length, 3) + 2}ch` }}
                            />
                            <button
                                onClick={handleEditSave}
                                className="text-xs text-secondary hover:text-secondary-hover px-1 py-0.5 cursor-pointer"
                            >
                                Save
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Edit — only for single word */}
                            {selection.wordIds.length === 1 && (
                                <Tooltip text="Edit word">
                                    <Button
                                        variant="icon"
                                        className="size-7!"
                                        icon={MdEdit}
                                        onClick={() => setSelection({ ...selection, isEditing: true })}
                                    />
                                </Tooltip>
                            )}
                            {/* Hide/Show — show both when selection has a mix */}
                            {(() => {
                                const seg = captionSegments?.find(s => s.id === selection.segmentId);
                                const selectedWords = seg?.words.filter(w => selection.wordIds.includes(w.id)) || [];
                                const hasVisible = selectedWords.some(w => !w.hidden);
                                const hasHidden = selectedWords.some(w => w.hidden);
                                return (
                                    <>
                                        {hasVisible && (
                                            <Tooltip text="Hide from caption">
                                                <Button
                                                    variant="icon"
                                                    className="size-7!"
                                                    icon={MdVisibilityOff}
                                                    onClick={handleHideSelected}
                                                />
                                            </Tooltip>
                                        )}
                                        {hasHidden && (
                                            <Tooltip text="Show">
                                                <Button
                                                    variant="icon"
                                                    className="size-7!"
                                                    icon={MdVisibility}
                                                    onClick={handleShowSelected}
                                                />
                                            </Tooltip>
                                        )}
                                    </>
                                );
                            })()}
                            {/* Cut — removes the selected words' time range from the output */}
                            <Tooltip text="Cut from video">
                                <Button
                                    variant="icon"
                                    icon={FiScissors}
                                    onClick={handleCutSelected}
                                />
                            </Tooltip>
                        </>
                    )}
                </div>,
                document.body
            )}



            {/* Modals for OpenAI pro gate */}
            <UpgradeModal
                isOpen={isUpgradeModalOpen}
                onClose={() => setIsUpgradeModalOpen(false)}
                onSignInRequest={() => {
                    setIsUpgradeModalOpen(false);
                    setIsAuthModalOpen(true);
                }}
            />
            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
                onAuthSuccess={() => setIsAuthModalOpen(false)}
            />
        </div>
    );
}
