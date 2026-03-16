import React, { useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { useToast } from '../Toast';
import { Slider, Tooltip, CollapsibleCard, Checkbox, Button } from '@shared/components';
import { analyzeForAutoCut } from '../../../core/autocut/autoCutAnalyzer';
import { getCachedSpeechSegments } from '../../../core/autocut/vadService';
import type { OutputWindow } from '../../../types';
import { PiVideoBold } from 'react-icons/pi';
import { HiSparkles } from 'react-icons/hi2';

export const ClipInspector: React.FC<{ window: OutputWindow }> = ({ window: win }) => {
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const removeOutputWindow = useProjectStore(s => s.removeOutputWindow);
    const setOutputWindows = useProjectStore(s => s.setOutputWindows);
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);
    const screenDurationMs = useProjectStore(s => s.project.screenSource.durationMs);
    const { batchAction } = useHistoryBatcher();

    // AutoCut sources
    const userEvents = useProjectStore(s => s.project.userEvents);
    const screenSource = useProjectStore(s => s.project.screenSource);
    const cameraSource = useProjectStore(s => s.project.cameraSource);
    const sourceDurationMs = useProjectStore(s => s.project.timeline.durationMs);
    const { addToast, updateToast, removeToast } = useToast();
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const micSource = useProjectStore(s => s.project.microphoneSource);
    const hasMic = !!micSource?.runtimeUrl;
    const hasUserEvents = userEvents.mousePositions.length > 0;
    const showAutoCut = hasMic && (!!cameraSource || hasUserEvents);

    const isLastWindow = outputWindows.length <= 1;
    const isAlreadyReset = isLastWindow && outputWindows[0]?.startMs === 0 && outputWindows[0]?.endMs === screenDurationMs && (outputWindows[0]?.speed || 1) === 1;

    const [applySpeedToAll, setApplySpeedToAll] = useState(false);

    const handleSpeedChange = useCallback((val: number) => {
        const rounded = Math.round(val * 10) / 10;
        batchAction(() => {
            updateOutputWindow(win.id, { speed: rounded });

            if (applySpeedToAll) {
                for (const w of outputWindows) {
                    if (w.id !== win.id) {
                        updateOutputWindow(w.id, { speed: rounded });
                    }
                }
            }
        });
    }, [win.id, batchAction, updateOutputWindow, applySpeedToAll, outputWindows]);

    const handleToggleSpeedAll = useCallback((checked: boolean) => {
        setApplySpeedToAll(checked);
        if (checked) {
            for (const w of outputWindows) {
                if (w.id !== win.id) {
                    updateOutputWindow(w.id, { speed: win.speed || 1 });
                }
            }
        }
    }, [win, outputWindows, updateOutputWindow]);

    const handleReset = useCallback(() => {
        setOutputWindows([{
            id: crypto.randomUUID(),
            startMs: 0,
            endMs: screenDurationMs,
            speed: 1,
        }]);
    }, [setOutputWindows, screenDurationMs]);

    const handleDelete = useCallback(() => {
        if (!isLastWindow) {
            removeOutputWindow(win.id);
        }
    }, [win.id, isLastWindow, removeOutputWindow]);

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

    return (
        <CollapsibleCard title="Clip" icon={<PiVideoBold size={16} />} notCollapsible>
            <div className="flex flex-col gap-5">
                <p className="subtext">Check the box to apply to all clips.</p>

                {/* Speed — custom label row with inline checkbox */}
                <div>
                    <div className="flex justify-between items-center mb-1.5">
                        <div className="flex items-center gap-1.5">
                            <Tooltip text="Apply to all clips">
                                <Checkbox
                                    checked={applySpeedToAll}
                                    onChange={handleToggleSpeedAll}
                                />
                            </Tooltip>
                            <span className="text-sm text-text-muted">Speed</span>
                        </div>
                        <span className="text-xs text-text-muted">
                            {(win.speed || 1).toFixed(1)}x
                        </span>
                    </div>
                    <Slider
                        value={win.speed || 1}
                        onChange={handleSpeedChange}
                        min={0.5}
                        max={3}
                        decimals={1}
                    />
                </div>

                {/* Delete & Reset */}
                <div className="flex flex-col gap-2 pt-2 border-t border-border">
                    {isLastWindow ? (
                        <Tooltip text="Cannot delete the only remaining clip">
                            <Button disabled size="sm" fullWidth className="opacity-50">
                            <span>Delete Clip</span>
                        </Button>
                        </Tooltip>
                    ) : (
                        <Button onClick={handleDelete} size="sm" fullWidth className="text-danger hover:text-danger">
                            <span>Delete Clip</span>
                        </Button>
                    )}

                    {/* Reset */}
                    <Tooltip text="Resets the timeline to one full clip">
                        <Button onClick={handleReset} disabled={isAlreadyReset} size="sm" fullWidth className={isAlreadyReset ? 'opacity-50' : ''}>
                            <span>Reset</span>
                        </Button>
                    </Tooltip>
                </div>

                {/* AutoCut */}
                {showAutoCut && (
                    <Tooltip text="Remove silent and inactive segments from the entire recording">
                        <Button
                            variant="primary"
                            size="sm"
                            fullWidth
                            onClick={handleAutoCut}
                            disabled={isAnalyzing}
                        >
                            <HiSparkles size={14} />
                            <span>AutoCut</span>
                        </Button>
                    </Tooltip>
                )}
            </div>
        </CollapsibleCard>
    );
};
