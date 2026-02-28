import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { TimelineHeaderCell } from './TimelineHeaderCell';
import { Checkbox } from '@shared/components';

interface ZoomHeaderCellProps {
    height: number;
}

export const ZoomHeaderCell: React.FC<ZoomHeaderCellProps> = ({ height }) => {
    const zoomEnabled = useProjectStore(s => s.project.settings.zoom.enabled ?? true);
    const toggleZoomEnabled = useProjectStore(s => s.toggleZoomEnabled);

    return (
        <TimelineHeaderCell
            title="Zoom"
            height={height}
            infoElement={
                <Checkbox
                    checked={zoomEnabled}
                    onChange={() => toggleZoomEnabled()}
                />
            }
        />
    );
};
