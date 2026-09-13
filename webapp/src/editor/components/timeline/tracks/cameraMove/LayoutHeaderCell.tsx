import React from 'react';
import { PiWebcamBold } from 'react-icons/pi';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';
import { CameraMoveTooltip } from '../../../shared/MediaTooltips';

interface LayoutHeaderCellProps {
    height: number;
    isCollapsed?: boolean;
}

export const LayoutHeaderCell: React.FC<LayoutHeaderCellProps> = ({ height, isCollapsed }) => {
    const cameraMoveEnabled = useProjectStore(s => s.project.settings.cameraMove?.enabled ?? true);
    const toggleCameraMoveEnabled = useProjectStore(s => s.toggleCameraMoveEnabled);

    return (
        <TimelineHeaderCell
            title="Layout"
            icon={<PiWebcamBold className="icon-sm" />}
            height={height}
            isCollapsed={isCollapsed}
            applyEnabled={cameraMoveEnabled}
            onToggleApply={toggleCameraMoveEnabled}
            titleElement={
                <CameraMoveTooltip
                    placement="top-right"
                    trigger={
                        <span
                            className="truncate select-none text-label"
                            style={{ fontSize: isCollapsed ? 9 : 13, transition: 'font-size 150ms ease' }}
                        >
                            Layout
                        </span>
                    }
                />
            }
        />
    );
};
