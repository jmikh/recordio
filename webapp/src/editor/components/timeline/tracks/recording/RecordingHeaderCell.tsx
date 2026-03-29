import React from 'react';
import { FaUndoAlt } from 'react-icons/fa';
import { BiVideoRecording } from 'react-icons/bi';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { Button } from '@shared/components';

interface RecordingHeaderCellProps {
    height: number;
}

export const RecordingHeaderCell: React.FC<RecordingHeaderCellProps> = ({ height }) => {
    const resetWindows = useProjectStore(s => s.resetWindows);
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);
    const sourceDurationMs = useProjectStore(s => s.project.timeline.durationMs);

    // Show reset if: multiple windows, any non-1x speed, or the full range doesn't cover [0, source end]
    const minStart = outputWindows.length > 0 ? Math.min(...outputWindows.map(w => w.startMs)) : 0;
    const maxEnd = outputWindows.length > 0 ? Math.max(...outputWindows.map(w => w.endMs)) : 0;
    const hasSpeedChange = outputWindows.some(w => (w.speed ?? 1) !== 1);
    const needsReset = outputWindows.length > 1 || hasSpeedChange || minStart !== 0 || (sourceDurationMs > 0 && maxEnd < sourceDurationMs);

    return (
        <TimelineHeaderCell
            title="Recording"
            icon={<BiVideoRecording size={16} />}
            height={height}
            infoElement={
                needsReset ? (
                    <Button
                        variant="icon"
                        onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            resetWindows();
                        }}
                        className="!text-text-disabled hover:!text-text-muted"
                        title="Reset to single window at 1× speed"
                    >
                        <FaUndoAlt size={12} />
                    </Button>
                ) : null
            }
        />
    );
};
