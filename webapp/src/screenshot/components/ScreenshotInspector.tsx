/**
 * Right panel: crop actions while cropping, the selected annotation's
 * settings (shared OverlayItemSettings + the screenshot-only variant
 * toggles, z-order and delete), or image info when nothing is selected.
 */
import { LuBringToFront, LuSendToBack, LuTrash2 } from 'react-icons/lu';
import { Button, CollapsibleCard, MultiToggle } from '@shared/components';
import type { ArrowOverlayItem, BlurOverlayItem, BorderOverlayItem, OverlayItem } from '@shared/types/overlay';
import { OverlayItemSettings } from '../../editor/components/settings/OverlayInspector';
import { useScreenshotDoc, useScreenshotHistoryBatcher, useScreenshotStore } from '../store/useScreenshotStore';
import { useScreenshotUIStore } from '../store/useScreenshotUIStore';
import { applyCrop, cancelCrop, deleteSelected, resetCrop } from '../actions';

const CAPTURE_MODE_LABEL = { visible: 'Visible area', fullPage: 'Full page', region: 'Selected area' } as const;

function itemLabel(item: OverlayItem): string {
    switch (item.type) {
        case 'blur': return item.mode === 'pixelate' ? 'Pixelate' : 'Blur';
        case 'text': return 'Text';
        case 'arrow': return item.headStyle === 'none' ? 'Line' : 'Arrow';
        case 'border': return item.shape === 'ellipse' ? 'Ellipse' : 'Rectangle';
    }
}

function VariantToggle({ item, updateItem }: { item: OverlayItem; updateItem: (u: Partial<OverlayItem>) => void }) {
    switch (item.type) {
        case 'blur':
            return (
                <MultiToggle<NonNullable<BlurOverlayItem['mode']>>
                    options={[{ value: 'blur', label: 'Blur' }, { value: 'pixelate', label: 'Pixelate' }]}
                    value={item.mode ?? 'blur'}
                    onChange={mode => updateItem({ mode } as Partial<OverlayItem>)}
                />
            );
        case 'border':
            return (
                <MultiToggle<NonNullable<BorderOverlayItem['shape']>>
                    options={[{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }]}
                    value={item.shape ?? 'rect'}
                    onChange={shape => updateItem({ shape } as Partial<OverlayItem>)}
                />
            );
        case 'arrow':
            return (
                <MultiToggle<NonNullable<ArrowOverlayItem['headStyle']>>
                    options={[{ value: 'arrow', label: 'Arrow' }, { value: 'none', label: 'Line' }]}
                    value={item.headStyle ?? 'arrow'}
                    onChange={headStyle => updateItem({ headStyle } as Partial<OverlayItem>)}
                />
            );
        default:
            return null;
    }
}

function CropPanel() {
    const doc = useScreenshotDoc();
    const draft = useScreenshotUIStore(s => s.cropDraft);
    if (!doc || !draft) return null;
    return (
        <CollapsibleCard title="Crop" notCollapsible>
            <div className="flex flex-col gap-3">
                <p className="text-label">
                    {Math.round(draft.width)} × {Math.round(draft.height)} px — drag the handles, then apply.
                </p>
                <Button variant="primary" fullWidth onClick={applyCrop}>Apply crop</Button>
                <div className="flex gap-2">
                    {doc.cropPx && (
                        <Button fullWidth onClick={resetCrop}>Remove crop</Button>
                    )}
                    <Button variant="ghost" fullWidth onClick={cancelCrop}>Cancel</Button>
                </div>
            </div>
        </CollapsibleCard>
    );
}

function SelectionPanel({ item }: { item: OverlayItem }) {
    const doc = useScreenshotDoc();
    const updateAnnotation = useScreenshotStore(s => s.updateAnnotation);
    const moveAnnotation = useScreenshotStore(s => s.moveAnnotation);
    const batcher = useScreenshotHistoryBatcher();
    if (!doc) return null;

    const updateItem = (updates: Partial<OverlayItem>) => updateAnnotation(item.id, updates);
    const index = doc.annotations.findIndex(a => a.id === item.id);
    const isTop = index === doc.annotations.length - 1;
    const isBottom = index === 0;

    return (
        <div className="flex flex-col gap-2">
            <CollapsibleCard title={itemLabel(item)} notCollapsible>
                <div className="flex flex-col gap-4">
                    <VariantToggle item={item} updateItem={updateItem} />
                    <OverlayItemSettings
                        item={item}
                        overlaySettings={doc.annotationDefaults}
                        updateItem={updateItem}
                        startInteraction={batcher.startInteraction}
                        endInteraction={batcher.endInteraction}
                        batchAction={batcher.batchAction}
                    />
                </div>
            </CollapsibleCard>

            <CollapsibleCard title="Arrange" notCollapsible>
                <div className="flex gap-2">
                    <Button fullWidth icon={LuBringToFront} disabled={isTop} onClick={() => moveAnnotation(item.id, 'forward')}>
                        Forward
                    </Button>
                    <Button fullWidth icon={LuSendToBack} disabled={isBottom} onClick={() => moveAnnotation(item.id, 'backward')}>
                        Backward
                    </Button>
                </div>
            </CollapsibleCard>

            <div className="px-1">
                <Button variant="destructive" fullWidth icon={LuTrash2} onClick={deleteSelected}>
                    Delete
                </Button>
            </div>
        </div>
    );
}

function InfoPanel() {
    const doc = useScreenshotDoc();
    if (!doc) return null;
    const { source } = doc;
    let host: string | null = null;
    if (source.pageUrl) {
        try { host = new URL(source.pageUrl).hostname; } catch { /* not a URL */ }
    }
    return (
        <div className="flex flex-col gap-2">
            <CollapsibleCard title="Screenshot" notCollapsible>
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-text-main">Pick a tool on the left, then click or drag on the image.</p>
                    <dl className="flex flex-col gap-1">
                        <div className="flex justify-between gap-2">
                            <dt className="text-label">Size</dt>
                            <dd className="text-xs text-text-main">{source.widthPx} × {source.heightPx} px</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                            <dt className="text-label">Capture</dt>
                            <dd className="text-xs text-text-main">{CAPTURE_MODE_LABEL[source.captureMode]}</dd>
                        </div>
                        {host && (
                            <div className="flex justify-between gap-2 min-w-0">
                                <dt className="text-label">Page</dt>
                                <dd className="text-xs text-text-main truncate" title={source.pageUrl}>{host}</dd>
                            </div>
                        )}
                        {doc.cropPx && (
                            <div className="flex justify-between gap-2">
                                <dt className="text-label">Crop</dt>
                                <dd className="text-xs text-text-main">{doc.cropPx.width} × {doc.cropPx.height} px</dd>
                            </div>
                        )}
                    </dl>
                    {doc.cropPx && (
                        <Button fullWidth onClick={resetCrop}>Remove crop</Button>
                    )}
                </div>
            </CollapsibleCard>
        </div>
    );
}

export function ScreenshotInspector() {
    const doc = useScreenshotDoc();
    const tool = useScreenshotUIStore(s => s.tool);
    const selectedId = useScreenshotUIStore(s => s.selectedId);
    const selected = doc?.annotations.find(a => a.id === selectedId) ?? null;

    return (
        <aside aria-label="Inspector" className="w-72 shrink-0 bg-surface border-l border-border overflow-y-auto scrollbar-thin p-2">
            {tool === 'crop' ? <CropPanel /> : selected ? <SelectionPanel item={selected} /> : <InfoPanel />}
        </aside>
    );
}
