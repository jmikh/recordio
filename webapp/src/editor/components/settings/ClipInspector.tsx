import React, { useCallback, useMemo } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Tooltip, CollapsibleCard } from '@shared/components';
import type { OutputWindow } from '../../../types';
import { MdDelete } from 'react-icons/md';
import { PiVideoBold } from 'react-icons/pi';

export const ClipInspector: React.FC<{ window: OutputWindow }> = ({ window: win }) => {
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const removeOutputWindow = useProjectStore(s => s.removeOutputWindow);
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);
    const { batchAction } = useHistoryBatcher();

    const isLastWindow = outputWindows.length <= 1;

    const durationMs = (win.endMs - win.startMs) / (win.speed || 1);
    const durationDisplay = useMemo(() => {
        const totalSec = durationMs / 1000;
        const min = Math.floor(totalSec / 60);
        const sec = (totalSec % 60).toFixed(1);
        return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    }, [durationMs]);

    const handleSpeedChange = useCallback((val: number) => {
        batchAction(() => updateOutputWindow(win.id, { speed: Math.round(val * 10) / 10 }));
    }, [win.id, batchAction, updateOutputWindow]);

    const handleDelete = useCallback(() => {
        if (!isLastWindow) {
            removeOutputWindow(win.id);
        }
    }, [win.id, isLastWindow, removeOutputWindow]);

    return (
        <CollapsibleCard title="Clip" icon={<PiVideoBold size={16} />} notCollapsible>
            <div className="flex flex-col gap-5">
                {/* Duration (read-only) */}
                <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-text-muted">Duration</span>
                    <span className="text-xs text-text-main font-mono">{durationDisplay}</span>
                </div>

                {/* Speed */}
                <Slider
                    label="Speed"
                    value={win.speed || 1}
                    onChange={handleSpeedChange}
                    min={0.5}
                    max={3}
                    decimals={1}
                    units="x"
                    showTooltip
                />

                {/* Delete */}
                <div className="flex flex-col gap-2 pt-2 border-t border-border">
                    {isLastWindow ? (
                        <Tooltip text="Cannot delete the last clip">
                            <button disabled className="interactive-ghost flex items-center justify-center gap-2 text-xs justify-start opacity-50">
                                <MdDelete size={16} />
                                <span>Delete Clip</span>
                            </button>
                        </Tooltip>
                    ) : (
                        <button onClick={handleDelete} className="interactive-ghost flex items-center justify-center gap-2 text-xs justify-start text-danger hover:text-danger">
                            <MdDelete size={16} />
                            <span>Delete Clip</span>
                        </button>
                    )}
                </div>
            </div>
        </CollapsibleCard>
    );
};
