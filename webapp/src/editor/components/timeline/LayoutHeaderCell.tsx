import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { TimelineHeaderCell } from './TimelineHeaderCell';
import { CameraLayoutTooltip } from '../shared/MediaTooltips';

interface LayoutHeaderCellProps {
    height: number;
    isCollapsed?: boolean;
}

export const LayoutHeaderCell: React.FC<LayoutHeaderCellProps> = ({ height, isCollapsed }) => {
    const cameraLayoutEnabled = useProjectStore(s => s.project.settings.cameraLayout?.enabled ?? true);

    return (
        <TimelineHeaderCell
            title="Webcam"
            height={height}
            disabled={!cameraLayoutEnabled}
            isCollapsed={isCollapsed}
            titleElement={
                <CameraLayoutTooltip
                    placement="top-right"
                    trigger={
                        <span
                            className={`truncate select-none ${!cameraLayoutEnabled ? 'text-text-muted' : 'text-text-main'}`}
                            style={{ fontSize: isCollapsed ? 9 : 14, transition: 'font-size 150ms ease' }}
                        >
                            Webcam
                        </span>
                    }
                />
            }
        />
    );
};
