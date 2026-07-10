import React, { useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { useToast } from '../../../components/Toast';
import { Slider, Tooltip, CollapsibleCard, Checkbox, Button } from '@shared/components';
import type { OutputWindow } from '@shared/types';
import { PiVideoBold } from 'react-icons/pi';

export const ClipInspector: React.FC<{ window: OutputWindow }> = ({ window: win }) => {
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const removeOutputWindow = useProjectStore(s => s.removeOutputWindow);
    const setOutputWindows = useProjectStore(s => s.setOutputWindows);
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);
    const screenDurationMs = useProjectStore(s => s.project.screenSource.durationMs);
    const { batchAction } = useHistoryBatcher();

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

    return (
        <CollapsibleCard title="Clip" icon={<PiVideoBold className="icon-md" />} notCollapsible>
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
            </div>
        </CollapsibleCard>
    );
};
