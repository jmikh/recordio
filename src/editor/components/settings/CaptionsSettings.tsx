import { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import type { CaptionSegment } from '../../../core/types';
import { Slider } from '../common/Slider';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { useTimeMapper } from '../../hooks/useTimeMapper';

/**
 * Settings panel for managing captions.
 */
export function CaptionsSettings() {
    const project = useProjectStore(state => state.project);
    const updateSettings = useProjectStore(state => state.updateSettings);
    const generateTranscription = useProjectStore(state => state.generateTranscription);
    const updateCaptionSegment = useProjectStore(state => state.updateCaptionSegment);
    const deleteCaptionSegment = useProjectStore(state => state.deleteCaptionSegment);
    const isTranscribing = useProjectStore(state => state.isTranscribing);
    const transcriptionProgress = useProjectStore(state => state.transcriptionProgress);
    const transcriptionError = useProjectStore(state => state.transcriptionError);

    // UI Store actions
    const setCanvasMode = useUIStore(state => state.setCanvasMode);
    const setIsPlaying = useUIStore(state => state.setIsPlaying);
    const setCurrentTime = useUIStore(state => state.setCurrentTime);

    const { batchAction, startInteraction, endInteraction } = useHistoryBatcher();
    const [editingId, setEditingId] = useState<string | null>(null);
    const inputRef = useRef<HTMLDivElement>(null);

    const captions = project.timeline.recording.captions;
    const settings = project.settings.captions || { visible: true, size: 24 };

    const timeMapper = useTimeMapper();

    // Focus when editing starts
    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editingId]);

    const handleGenerate = async () => {
        try {
            console.log('[CaptionsSettings] Starting transcription generation');
            await generateTranscription();
        } catch (error) {
            console.error('[CaptionsSettings] Failed to generate transcription:', error);
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

    return (
        <div className="space-y-4">
            {/* Caption Settings */}
            <div className="space-y-3 pb-3 border-b border-border">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-text-muted">Visible</label>
                    <button
                        onClick={() => updateSettings({ captions: { ...settings, visible: !settings.visible } })}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${settings.visible ? 'bg-settings-primary' : 'bg-surface-elevated'
                            }`}
                    >
                        <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${settings.visible ? 'translate-x-5' : 'translate-x-1'
                                }`}
                        />
                    </button>
                </div>

                <Slider
                    value={settings.size}
                    onChange={(value) => updateSettings({ captions: { ...settings, size: value } })}
                    min={16}
                    max={48}
                    label="Size"
                    units="px"
                    decimals={0}
                />
            </div>



            {
                !isTranscribing && (
                    <div className="flex flex-col gap-2">
                        {!captions ? (
                            <button
                                onClick={handleGenerate}
                                className="w-full px-4 py-2 bg-settings-primary text-primary-fg rounded-lg hover:bg-settings-primary/90 transition-colors text-sm font-medium"
                            >
                                Generate Captions
                            </button>
                        ) : (
                            <button
                                onClick={handleGenerate}
                                className="w-full px-3 py-1.5 bg-surface-elevated text-text-primary hover:bg-surface-elevated-hover rounded-md transition-colors text-xs font-medium border border-border"
                            >
                                Regenerate Captions
                            </button>
                        )}
                    </div>
                )
            }

            {
                isTranscribing && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-text-muted">
                            <span>Transcribing audio...</span>
                            <span>{Math.round(transcriptionProgress * 100)}%</span>
                        </div>
                        <div className="w-full h-2 bg-surface-elevated rounded-full overflow-hidden">
                            <div
                                className="h-full bg-settings-primary transition-all duration-300"
                                style={{ width: `${transcriptionProgress * 100}%` }}
                            />
                        </div>
                    </div>
                )
            }

            {
                transcriptionError && (
                    <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded border border-red-500/20">
                        {transcriptionError}
                    </div>
                )
            }

            {
                captions && captions.segments.length > 0 && (
                    <div className="space-y-2">
                        <div className="space-y-2">
                            {(() => {
                                return captions.segments.map(segment => {
                                    const range = timeMapper.mapSourceRangeToOutputRange(segment.sourceStartMs, segment.sourceEndMs);
                                    if (!range) return null;
                                    const outputStart = range.start;
                                    const outputEnd = range.end;
                                    const isEditing = editingId === segment.id;

                                    return (
                                        <div key={segment.id} className={`relative inline-block bg-surface text-white px-3 py-2 rounded font-medium text-xs w-full border transition-colors ${isEditing ? 'border-settings-primary' : 'border-transparent'}`}>
                                            {/* Delete button - top right of entire div */}
                                            <button
                                                onClick={() => handleDelete(segment.id)}
                                                className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center text-white/60 hover:text-red-400 transition-colors rounded z-10"
                                                title="Delete caption"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>

                                            {/* Timestamps - Row Layout */}
                                            <div className="mb-1 flex items-center justify-center gap-1 text-white font-mono text-[10px]">
                                                <div className="bg-surface-elevated px-1.5 py-1 rounded">
                                                    {formatTime(outputStart)}
                                                </div>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
                                                    <line x1="5" y1="12" x2="19" y2="12" />
                                                    <polyline points="12 5 19 12 12 19" />
                                                </svg>
                                                <div className="bg-surface-elevated px-1.5 py-1 rounded">
                                                    {formatTime(outputEnd)}
                                                </div>
                                            </div>

                                            {/* Caption text - wraps around timestamps */}
                                            <div
                                                ref={isEditing ? inputRef : null}
                                                contentEditable={isEditing}
                                                suppressContentEditableWarning
                                                onInput={(e) => handleInput(e, segment.id)}
                                                onKeyDown={handleKeyDown}
                                                onBlur={handleBlur}
                                                className="cursor-text"
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
                                    );
                                });
                            })()}
                        </div>
                    </div>
                )
            }
        </div >
    );
}
