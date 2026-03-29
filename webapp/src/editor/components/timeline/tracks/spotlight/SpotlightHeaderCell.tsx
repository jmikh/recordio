import React from 'react';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';
import { SpotlightTooltip } from '../../../shared/MediaTooltips';

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
            height={height}
            disabled={!spotlightEnabled}
            isCollapsed={isCollapsed}
            applyEnabled={spotlightEnabled}
            onToggleApply={toggleSpotlightEnabled}
            titleElement={
                <SpotlightTooltip
                    placement="top-right"
                    trigger={
                        <span
                            className={`truncate select-none ${!spotlightEnabled ? 'text-text-muted' : 'text-text-main'}`}
                            style={{ fontSize: isCollapsed ? 9 : 14, transition: 'font-size 150ms ease' }}
                        >
                            Spotlight
                        </span>
                    }
                />
            }
        />
    );
};
