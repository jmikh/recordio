import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { TimelineHeaderCell } from './TimelineHeaderCell';
import { Checkbox } from '@shared/components';

interface SpotlightHeaderCellProps {
    height: number;
}

export const SpotlightHeaderCell: React.FC<SpotlightHeaderCellProps> = ({ height }) => {
    const spotlightEnabled = useProjectStore(s => s.project.settings.spotlight.enabled ?? true);
    const toggleSpotlightEnabled = useProjectStore(s => s.toggleSpotlightEnabled);

    return (
        <TimelineHeaderCell
            title="Spotlight"
            height={height}
            disabled={!spotlightEnabled}
            infoElement={
                <Checkbox
                    checked={spotlightEnabled}
                    onChange={() => toggleSpotlightEnabled()}
                />
            }
        />
    );
};
