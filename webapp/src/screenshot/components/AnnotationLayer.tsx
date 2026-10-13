/**
 * Interactive layer for the selection: the shared OverlayItemEditor
 * (bounding box / arrow handles / inline text) for an annotation, or the
 * SpotlightEditor for the spotlight, driven by the screenshot stores.
 * Lives inside ScreenshotCanvas's source-space wrapper, so `mapper` maps
 * uncropped source px → display px.
 */
import { useCallback } from 'react';
import type { DisplayMapper } from '@shared/mappers/displayMapper';
import type { Rect } from '@shared/types';
import type { OverlayItem } from '@shared/types/overlay';
import type { ScreenshotSpotlight } from '@shared/types/screenshot';
import { DisplayMapperProvider } from '../../editor/hooks/useDisplayMapper';
import { OverlayItemEditor } from '../../editor/components/canvas/overlay-item';
import { useScreenshotDoc, useScreenshotHistoryBatcher, useScreenshotStore } from '../store/useScreenshotStore';
import { useScreenshotUIStore } from '../store/useScreenshotUIStore';
import { screenshotScales } from '../geometry';
import { SpotlightEditor } from './SpotlightEditor';

interface AnnotationLayerProps {
    mapper: DisplayMapper;
    /** The visible region (crop) — items are constrained to it while dragging */
    view: Rect;
    previewItemRef: React.MutableRefObject<OverlayItem | null>;
    previewSpotlightRef: React.MutableRefObject<ScreenshotSpotlight | null>;
}

export function AnnotationLayer({ mapper, view, previewItemRef, previewSpotlightRef }: AnnotationLayerProps) {
    const doc = useScreenshotDoc();
    const selectedId = useScreenshotUIStore(s => s.selectedId);
    const isEditingText = useScreenshotUIStore(s => s.isEditingText);
    const enterTextEdit = useScreenshotUIStore(s => s.enterTextEdit);
    const exitTextEdit = useScreenshotUIStore(s => s.exitTextEdit);
    const updateAnnotation = useScreenshotStore(s => s.updateAnnotation);
    const updateSpotlight = useScreenshotStore(s => s.updateSpotlight);
    const batcher = useScreenshotHistoryBatcher();

    const updateItem = useCallback((updates: Partial<OverlayItem>) => {
        if (selectedId) updateAnnotation(selectedId, updates);
    }, [selectedId, updateAnnotation]);

    const item = doc?.annotations.find(a => a.id === selectedId);
    const spotlight = doc?.spotlight && doc.spotlight.id === selectedId ? doc.spotlight : null;
    if (!item && !spotlight) return null;

    return (
        <DisplayMapperProvider value={mapper}>
            {/* Contrasting outline for bounding box visibility on any background */}
            <style>{`
                .overlay-editor-contrast #bounding-box {
                    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
                }
            `}</style>
            <div className="overlay-editor-contrast absolute inset-0 pointer-events-none">
                {spotlight ? (
                    <SpotlightEditor
                        spotlight={spotlight}
                        updateSpotlight={updateSpotlight}
                        previewRef={previewSpotlightRef}
                        constraintBounds={view}
                    />
                ) : item && (
                    <OverlayItemEditor
                        item={item}
                        updateItem={updateItem}
                        batcher={batcher}
                        previewItemRef={previewItemRef}
                        textScale={screenshotScales(view.width).textScale}
                        constraintBounds={view}
                        isEditing={isEditingText && item.type === 'text'}
                        onEnterEdit={enterTextEdit}
                        onExitEdit={exitTextEdit}
                        hideLinkToggle
                    />
                )}
            </div>
        </DisplayMapperProvider>
    );
}
