import React from 'react';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';

interface RecordingHeaderCellProps {
    height: number;
}

export const RecordingHeaderCell: React.FC<RecordingHeaderCellProps> = ({ height }) => {
    return (
        <TimelineHeaderCell
            title="Recording"
            height={height}
        />
    );
};
