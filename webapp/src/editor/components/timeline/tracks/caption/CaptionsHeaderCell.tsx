import React from 'react';
import { useProjectStore } from '../../../../stores/useProjectStore';
import { TimelineHeaderCell } from '../shared/TimelineHeaderCell';

interface CaptionsHeaderCellProps {
    height: number;
    isCollapsed?: boolean;
}

export const CaptionsHeaderCell: React.FC<CaptionsHeaderCellProps> = ({ height, isCollapsed }) => {
    const captionsEnabled = useProjectStore(s => s.project.settings.captions.enabled ?? true);
    const toggleCaptionsEnabled = () => {
        const state = useProjectStore.getState();
        const captions = state.project.settings.captions;
        state.updateSettings({ captions: { ...captions, enabled: !(captions.enabled ?? true) } });
    };

    return (
        <TimelineHeaderCell
            title="Captions"
            height={height}
            disabled={!captionsEnabled}
            isCollapsed={isCollapsed}
            applyEnabled={captionsEnabled}
            onToggleApply={toggleCaptionsEnabled}
        />
    );
};
