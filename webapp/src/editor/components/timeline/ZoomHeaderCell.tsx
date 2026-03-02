import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { TimelineHeaderCell } from './TimelineHeaderCell';

interface ZoomHeaderCellProps {
    height: number;
    isCollapsed?: boolean;
}

export const ZoomHeaderCell: React.FC<ZoomHeaderCellProps> = ({ height, isCollapsed }) => {
    const zoomEnabled = useProjectStore(s => s.project.settings.zoom.enabled ?? true);

    return (
        <TimelineHeaderCell
            title="Zoom"
            height={height}
            disabled={!zoomEnabled}
            isCollapsed={isCollapsed}
        />
    );
};
