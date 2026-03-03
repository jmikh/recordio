import React from 'react';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';
import { CameraMoveTooltip } from '../../../shared/MediaTooltips';

interface LayoutHeaderCellProps {
    height: number;
    isCollapsed?: boolean;
}

export const LayoutHeaderCell: React.FC<LayoutHeaderCellProps> = ({ height, isCollapsed }) => {
    const cameraMoveEnabled = useProjectStore(s => s.project.settings.cameraMove?.enabled ?? true);

    return (
        <TimelineHeaderCell
            title="Camera"
            height={height}
            disabled={!cameraMoveEnabled}
            isCollapsed={isCollapsed}
            titleElement={
                <CameraMoveTooltip
                    placement="top-right"
                    trigger={
                        <span
                            className={`truncate select-none ${!cameraMoveEnabled ? 'text-text-muted' : 'text-text-main'}`}
                            style={{ fontSize: isCollapsed ? 9 : 14, transition: 'font-size 150ms ease' }}
                        >
                            Camera
                        </span>
                    }
                />
            }
        />
    );
};
