import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { TimelineHeaderCell } from './TimelineHeaderCell';
import { Checkbox } from '@shared/components';

interface CaptionsHeaderCellProps {
    height: number;
}

export const CaptionsHeaderCell: React.FC<CaptionsHeaderCellProps> = ({ height }) => {
    const captionsEnabled = useProjectStore(s => s.project.settings.captions.enabled ?? true);
    const updateSettings = useProjectStore(s => s.updateSettings);

    const toggle = () => {
        const captions = useProjectStore.getState().project.settings.captions;
        updateSettings({ captions: { ...captions, enabled: !captionsEnabled } });
    };

    return (
        <TimelineHeaderCell
            title="Captions"
            height={height}
            infoElement={
                <Checkbox
                    checked={captionsEnabled}
                    onChange={() => toggle()}
                />
            }
        />
    );
};
