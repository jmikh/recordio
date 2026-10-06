import React from 'react';
import { LuLightbulb } from 'react-icons/lu';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';

interface SpotlightHeaderCellProps {
    height: number;
    isCollapsed?: boolean;
}

export const SpotlightHeaderCell: React.FC<SpotlightHeaderCellProps> = ({ height, isCollapsed }) => {
    const spotlightEnabled = useProjectStore(s => s.project.settings.spotlight.enabled ?? true);
    const toggleSpotlightEnabled = useProjectStore(s => s.toggleSpotlightEnabled);

    return (
        <TimelineHeaderCell
            title="Spotlight"
            icon={LuLightbulb}
            height={height}
            isCollapsed={isCollapsed}
            applyEnabled={spotlightEnabled}
            onToggleApply={toggleSpotlightEnabled}
        />
    );
};
