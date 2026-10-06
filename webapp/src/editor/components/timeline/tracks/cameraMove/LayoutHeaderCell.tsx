import React from 'react';
import { LuCamera } from 'react-icons/lu';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';

interface LayoutHeaderCellProps {
    height: number;
    isCollapsed?: boolean;
}

export const LayoutHeaderCell: React.FC<LayoutHeaderCellProps> = ({ height, isCollapsed }) => {
    const cameraMoveEnabled = useProjectStore(s => s.project.settings.cameraMove?.enabled ?? true);
    const toggleCameraMoveEnabled = useProjectStore(s => s.toggleCameraMoveEnabled);

    return (
        <TimelineHeaderCell
            title="Layout"
            icon={LuCamera}
            height={height}
            isCollapsed={isCollapsed}
            applyEnabled={cameraMoveEnabled}
            onToggleApply={toggleCameraMoveEnabled}
        />
    );
};
