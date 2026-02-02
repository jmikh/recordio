import React from 'react';
import { LegendTooltip, LegendItem } from '../shared/LegendTooltip';
import { legendItem } from './ZoomTrackStyles';

/**
 * ZoomLegend displays an info icon that shows a tooltip explaining
 * the zoom track visual elements.
 */
export const ZoomLegend: React.FC = () => {
    return (
        <LegendTooltip
            videoSrc="/assets/demos/zoom-demo.mp4"
            description="Zoom and pan to where the action is happening with smooth transitions."
        >
            <LegendItem
                indicator={
                    <div
                        className={legendItem.holdLine.className}
                        style={legendItem.holdLine.style}
                    />
                }
                label="Zoomed hold"
            />
            <LegendItem
                indicator={
                    <div
                        className={legendItem.transitionTrail.className}
                        style={legendItem.transitionTrail.style}
                    />
                }
                label="Transition"
            />
            <LegendItem
                indicator={
                    <div
                        className={legendItem.diamond.className}
                        style={legendItem.diamond.style}
                    />
                }
                label="Keyframe"
            />
            <LegendItem
                indicator={
                    <div
                        className={legendItem.square.className}
                        style={legendItem.square.style}
                    />
                }
                label="Full viewport"
            />
        </LegendTooltip>
    );
};
