import React from 'react';
import { LuVideo } from 'react-icons/lu';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';

interface ClipHeaderCellProps {
    height: number;
}

export const ClipHeaderCell: React.FC<ClipHeaderCellProps> = ({ height }) => (
    <TimelineHeaderCell
        title="Clip"
        icon={LuVideo}
        height={height}
    />
);
