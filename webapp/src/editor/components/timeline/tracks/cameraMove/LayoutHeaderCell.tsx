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
            icon={<PiWebcamBold size={16} />}
            height={height}
            disabled={!cameraMoveEnabled}
            isCollapsed={isCollapsed}
            applyEnabled={cameraMoveEnabled}
            onToggleApply={toggleCameraMoveEnabled}
            titleElement={
                <CameraMoveTooltip
                    placement="top-right"
                    trigger={
                        <span
                            className={`truncate select-none ${!cameraMoveEnabled ? 'text-text-muted' : 'text-text-main'}`}
                            style={{ fontSize: isCollapsed ? 9 : 14, transition: 'font-size 150ms ease' }}
                        >
                            Layout
                        </span>
                    }
                />
            }
        />
    );
};
