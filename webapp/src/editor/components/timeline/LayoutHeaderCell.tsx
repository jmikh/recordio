import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { TimelineHeaderCell } from './TimelineHeaderCell';
import { Checkbox } from '@shared/components';
import { CameraLayoutTooltip } from '../shared/MediaTooltips';

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
            titleElement={
                <CameraLayoutTooltip
                    placement="top-right"
                    trigger={
                        <span className={`text-sm truncate select-none ${!cameraLayoutEnabled ? 'text-text-muted' : 'text-text-main'}`}>
                            Cam Layout
                        </span>
                    }
                />
            }
            infoElement={
                <Checkbox
                    checked={cameraLayoutEnabled}
                    onChange={() => toggleCameraLayoutEnabled()}
                />
            }
        />
    );
};
