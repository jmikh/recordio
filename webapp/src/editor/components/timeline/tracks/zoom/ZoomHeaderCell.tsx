import React from 'react';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { LuZoomIn } from 'react-icons/lu';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';

interface ZoomHeaderCellProps {
    height: number;
    isCollapsed?: boolean;
}

export const ZoomHeaderCell: React.FC<ZoomHeaderCellProps> = ({ height, isCollapsed }) => {
    const zoomEnabled = useProjectStore(s => s.project.settings.zoom.enabled ?? true);
    const toggleZoomEnabled = useProjectStore(s => s.toggleZoomEnabled);

    return (
        <TimelineHeaderCell
            title="Zoom"
            icon={<LuZoomIn className="icon-sm" />}
            height={height}
            isCollapsed={isCollapsed}
            applyEnabled={zoomEnabled}
            onToggleApply={toggleZoomEnabled}
        />
    );
};
