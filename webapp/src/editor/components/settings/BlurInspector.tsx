import React, { useCallback } from 'react';
import { TbBlur } from 'react-icons/tb';
import { LuPlus } from 'react-icons/lu';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { CollapsibleCard, Button, Slider } from '@shared/components';
import type { BlurSegment } from '@shared/types';
import { createDefaultBlurRegion, MAX_BLUR_RADIUS_PX, MIN_BLUR_RADIUS_PX } from '../../blur/blurDefaults';

/** Blur radius shown as a 10–100% strength. */
const toStrengthPercent = (radiusPx: number) =>
    Math.round(10 + ((radiusPx - MIN_BLUR_RADIUS_PX) / (MAX_BLUR_RADIUS_PX - MIN_BLUR_RADIUS_PX)) * 90);

export const BlurInspector: React.FC<{ segment: BlurSegment }> = ({ segment }) => {
    const updateBlurSegment = useProjectStore(s => s.updateBlurSegment);
    const deleteBlurSegment = useProjectStore(s => s.deleteBlurSegment);
    const clearBlurSegments = useProjectStore(s => s.clearBlurSegments);
    const addBlurRegion = useProjectStore(s => s.addBlurRegion);
    const deleteBlurRegion = useProjectStore(s => s.deleteBlurRegion);
    const outputSize = useProjectStore(s => s.project.settings.outputSize);
    const selectBlurSegment = useUIStore(s => s.selectBlurSegment);
    const selectBlurRegion = useUIStore(s => s.selectBlurRegion);
    const selectedRegionId = useUIStore(s => s.selectedBlurRegionId);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const regionCount = segment.regions.length;
    const activeRegionId = segment.regions.find(r => r.id === selectedRegionId)?.id ?? segment.regions[0]?.id;

    const handleStrengthChange = useCallback((val: number) => {
        batchAction(() => {
            updateBlurSegment(segment.id, { blurRadiusPx: val });
        });
    }, [segment.id, batchAction, updateBlurSegment]);

    const handleAddRegion = useCallback(() => {
        const region = createDefaultBlurRegion(outputSize, regionCount);
        addBlurRegion(segment.id, region);
        selectBlurRegion(region.id);
    }, [segment.id, outputSize, regionCount, addBlurRegion, selectBlurRegion]);

    const handleDeleteRegion = useCallback(() => {
        if (!activeRegionId) return;
        deleteBlurRegion(segment.id, activeRegionId);
        const remaining = segment.regions.filter(r => r.id !== activeRegionId);
        selectBlurRegion(remaining[remaining.length - 1]?.id ?? null);
    }, [segment.id, segment.regions, activeRegionId, deleteBlurRegion, selectBlurRegion]);

    const handleDelete = useCallback(() => {
        deleteBlurSegment(segment.id);
        selectBlurSegment(null);
    }, [segment.id, deleteBlurSegment, selectBlurSegment]);

    const handleDeleteAll = useCallback(() => {
        clearBlurSegments();
        selectBlurSegment(null);
    }, [clearBlurSegments, selectBlurSegment]);

    return (
        <CollapsibleCard title="Blur" icon={<TbBlur className="icon-md" />} notCollapsible>
            <div className="flex flex-col gap-5">
                <p className="text-label">
                    Every region is blurred for the length of this block. Drag on the video to add another region.
                </p>

                {/* Strength */}
                <div>
                    <div className="flex justify-between items-center mb-1.5">
                        <span className="text-label">Blur Amount</span>
                        <span className="text-label">{toStrengthPercent(segment.blurRadiusPx)}%</span>
                    </div>
                    <Slider
                        value={segment.blurRadiusPx}
                        onChange={handleStrengthChange}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        min={MIN_BLUR_RADIUS_PX}
                        max={MAX_BLUR_RADIUS_PX}
                    />
                </div>

                {/* Regions */}
                <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                        <span className="text-label">Regions</span>
                        <span className="text-label">{regionCount}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button icon={LuPlus} onClick={handleAddRegion} className="flex-1">
                            Add Region
                        </Button>
                        {regionCount > 1 && (
                            <Button onClick={handleDeleteRegion} className="flex-1 text-danger hover:text-danger">
                                Delete Region
                            </Button>
                        )}
                    </div>
                </div>

                {/* Delete */}
                <div className="flex items-center gap-2">
                    <Button onClick={handleDelete} className="flex-1 text-danger hover:text-danger">
                        <span>Delete This</span>
                    </Button>
                    <Button onClick={handleDeleteAll} className="flex-1 text-danger hover:text-danger">
                        <span>Delete All</span>
                    </Button>
                </div>
            </div>
        </CollapsibleCard>
    );
};
