/**
 * Bounding box for the selected spotlight: move, resize and round its
 * corners. A drag only touches a local replica and the canvas preview ref
 * (the canvas paints the real dim live); the store gets one update — one
 * undo step — when the drag commits. Rendered by AnnotationLayer inside
 * its DisplayMapperProvider (uncropped source px → display px).
 */
import { useEffect, useState } from 'react';
import type { Rect } from '@shared/types';
import type { ScreenshotSpotlight } from '@shared/types/screenshot';
import { BoundingBox } from '../../editor/components/canvas/bounding-box';
import { useDisplayMapper } from '../../editor/hooks/useDisplayMapper';

interface SpotlightEditorProps {
    spotlight: ScreenshotSpotlight;
    updateSpotlight: (updates: Partial<ScreenshotSpotlight>) => void;
    /** The in-drag replica the canvas paints instead of the store spotlight */
    previewRef: React.MutableRefObject<ScreenshotSpotlight | null>;
    /** The visible region (crop) — the spotlight stays inside it */
    constraintBounds: Rect;
}

export function SpotlightEditor({ spotlight, updateSpotlight, previewRef, constraintBounds }: SpotlightEditorProps) {
    const { outputSize } = useDisplayMapper();
    const [local, setLocal] = useState(spotlight);

    // Follow the store (commit, undo/redo, inspector edits); that ends any preview
    const [synced, setSynced] = useState(spotlight);
    if (synced !== spotlight) {
        setSynced(spotlight);
        setLocal(spotlight);
    }
    useEffect(() => { previewRef.current = null; }, [spotlight, previewRef]);
    useEffect(() => () => { previewRef.current = null; }, [previewRef]);

    const preview = (updates: Partial<ScreenshotSpotlight>) => {
        setLocal(prev => {
            const next = { ...prev, ...updates };
            previewRef.current = next;
            return next;
        });
    };
    const commit = (updates: Partial<ScreenshotSpotlight>) => {
        preview(updates);
        updateSpotlight(updates);
    };

    return (
        <BoundingBox
            rect={local.rectPx}
            minSize={Math.min(outputSize.width, outputSize.height) * 0.04}
            constraintBounds={constraintBounds}
            onChange={rectPx => preview({ rectPx })}
            onCommit={rectPx => commit({ rectPx })}
            allowCornerEditing
            hideLinkToggle
            cornerRadii={local.borderRadiusPx}
            onCornerRadiiChange={borderRadiusPx => preview({ borderRadiusPx })}
            onCornerRadiiCommit={borderRadiusPx => commit({ borderRadiusPx })}
        />
    );
}
