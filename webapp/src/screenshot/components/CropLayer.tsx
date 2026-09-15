/**
 * Crop mode: the full source is shown, dimmed outside the draft rect,
 * with a BoundingBox to adjust it. Apply / reset / cancel live in the
 * inspector and the keyboard shortcuts (actions.ts).
 */
import type { DisplayMapper } from '@shared/mappers/displayMapper';
import type { Size } from '@shared/types';
import { DisplayMapperProvider } from '../../editor/hooks/useDisplayMapper';
import { BoundingBox } from '../../editor/components/canvas/bounding-box';
import { DimmedOverlay } from '../../editor/components/canvas/DimmedOverlay';
import { useScreenshotUIStore } from '../store/useScreenshotUIStore';
import { fullSourceRect } from '../geometry';

const MIN_CROP_PX = 16;

interface CropLayerProps {
    /** Maps uncropped source px → display px */
    mapper: DisplayMapper;
    sourceSize: Size;
}

export function CropLayer({ mapper, sourceSize }: CropLayerProps) {
    const cropDraft = useScreenshotUIStore(s => s.cropDraft);
    const setCropDraft = useScreenshotUIStore(s => s.setCropDraft);
    if (!cropDraft) return null;

    return (
        <DisplayMapperProvider value={mapper}>
            <DimmedOverlay holeRect={cropDraft} opacity={0.55} />
            <div className="absolute inset-0 pointer-events-none">
                <BoundingBox
                    rect={cropDraft}
                    minSize={MIN_CROP_PX}
                    constraintBounds={fullSourceRect(sourceSize)}
                    onChange={setCropDraft}
                    onCommit={setCropDraft}
                />
            </div>
        </DisplayMapperProvider>
    );
}
