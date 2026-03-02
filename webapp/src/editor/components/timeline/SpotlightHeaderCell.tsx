import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { TimelineHeaderCell } from './TimelineHeaderCell';
import { Checkbox } from '@shared/components';
import { SpotlightTooltip } from '../shared/MediaTooltips';

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
            titleElement={
                <SpotlightTooltip
                    placement="top-right"
                    trigger={
                        <span className={`text-sm truncate select-none ${!spotlightEnabled ? 'text-text-muted' : 'text-text-main'}`}>
                            Spotlight
                        </span>
                    }
                />
            }
            infoElement={
                <Checkbox
                    checked={spotlightEnabled}
                    onChange={() => toggleSpotlightEnabled()}
                />
            }
        />
    );
};
