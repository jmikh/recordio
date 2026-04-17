import React from 'react';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { LuLayers3 } from 'react-icons/lu';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';

interface OverlayHeaderCellProps {
    height: number;
    isCollapsed?: boolean;
}

export const OverlayHeaderCell: React.FC<OverlayHeaderCellProps> = ({ height, isCollapsed }) => {
    const overlayEnabled = useProjectStore(s => s.project.settings.overlay?.enabled ?? true);
    const toggleOverlayEnabled = useProjectStore(s => s.toggleOverlayEnabled);

    return (
        <TimelineHeaderCell
            title="Overlay"
            icon={<LuLayers3 className="icon-md" />}
            height={height}
            disabled={!overlayEnabled}
            isCollapsed={isCollapsed}
            applyEnabled={overlayEnabled}
            onToggleApply={toggleOverlayEnabled}
        />
    );
};
