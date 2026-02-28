import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { TimelineHeaderCell } from './TimelineHeaderCell';
import { Checkbox } from '@shared/components';

interface LayoutHeaderCellProps {
    height: number;
}

export const LayoutHeaderCell: React.FC<LayoutHeaderCellProps> = ({ height }) => {
    const cameraLayoutEnabled = useProjectStore(s => s.project.settings.cameraLayout?.enabled ?? true);
    const toggleCameraLayoutEnabled = useProjectStore(s => s.toggleCameraLayoutEnabled);

    return (
        <TimelineHeaderCell
            title="Cam Layout"
            height={height}
            disabled={!cameraLayoutEnabled}
            infoElement={
                <Checkbox
                    checked={cameraLayoutEnabled}
                    onChange={() => toggleCameraLayoutEnabled()}
                />
            }
        />
    );
};
