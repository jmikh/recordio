import React from 'react';
import { TbBlur } from 'react-icons/tb';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';

interface BlurHeaderCellProps {
    height: number;
    isCollapsed?: boolean;
}

export const BlurHeaderCell: React.FC<BlurHeaderCellProps> = ({ height, isCollapsed }) => {
    const blurEnabled = useProjectStore(s => s.project.settings.blur?.enabled ?? true);
    const toggleBlurEnabled = useProjectStore(s => s.toggleBlurEnabled);

    return (
        <TimelineHeaderCell
            title="Blur"
            icon={TbBlur}
            height={height}
            isCollapsed={isCollapsed}
            applyEnabled={blurEnabled}
            onToggleApply={toggleBlurEnabled}
        />
    );
};
