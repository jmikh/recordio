import React, { useCallback, useState, useMemo } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useOverlayEditorStore } from '../canvas/useOverlayEditorStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { CollapsibleCard, Button, Slider, MultiToggle, Checkbox, Tooltip, type DropdownOption } from '@shared/components';
import { ColorButton } from './ColorButton';
import { MdLayers, MdBlurOn, MdOutlineTextFields, MdBorderOuter, MdSettings } from 'react-icons/md';
import { RiArrowRightUpFill } from 'react-icons/ri';
import type { OverlayBlock, OverlayItem, OverlayItemType, BlurOverlayItem, TextOverlayItem, ArrowOverlayItem, BorderOverlayItem } from '../../../types/overlay';
import type { OverlaySettings } from '../../../types/settings';
import type { Size } from '../../../types';

const OVERLAY_TYPE_LABELS: Record<OverlayItemType, string> = {
    blur: 'Blur',
    text: 'Text',
    arrow: 'Arrow',
    border: 'Outline',
};

const OVERLAY_TYPE_ICONS: Record<OverlayItemType, React.ReactNode> = {
    blur: <MdBlurOn size={14} />,
    text: <MdOutlineTextFields size={14} />,
    arrow: <RiArrowRightUpFill size={14} />,
    border: <MdBorderOuter size={14} />,
};

// ============================================================================
// Default item factory — reads from settings defaults
// ============================================================================

// Hardcoded fallbacks for projects without saved defaults
const BLUR_FALLBACK = { blurRadiusPx: 20 };
const TEXT_FALLBACK = { color: '#ffffff', backgroundColor: '#00000080', fontSizePx: 0 };
const ARROW_FALLBACK = { color: '#7B61FF', strokeWidthPx: 4, headScale: 1.0 };
const BORDER_FALLBACK = { color: '#7B61FF', borderWidthPx: 4 };

// Reference constants for text overlays (designed for 1080px height, following captionPainter)
const TEXT_REF_HEIGHT = 1080;
const TEXT_REF_PADDING = 8;
const TEXT_REF_RADIUS = 6;

const createDefaultItem = (type: OverlayItemType, outputSize: Size, overlaySettings: OverlaySettings): OverlayItem => {
    const id = crypto.randomUUID();
    const { width: W, height: H } = outputSize;

    switch (type) {
        case 'blur': {
            const d = overlaySettings.blurDefaults ?? BLUR_FALLBACK;
            const w = Math.round(W * 0.2);
            const h = Math.round(H * 0.15);
            return {
                id, type: 'blur',
                rectPx: { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), width: w, height: h },
                blurRadiusPx: d.blurRadiusPx,
                borderRadiusPx: [0, 0, 0, 0],
            };
        }
        case 'text': {
            const d = overlaySettings.textDefaults ?? TEXT_FALLBACK;
            const fontSize = d.fontSizePx > 0 ? d.fontSizePx : Math.round(Math.min(W, H) * 0.05);
            const scale = H / TEXT_REF_HEIGHT;
            return {
                id, type: 'text', text: 'Text',
                topLeft: { x: Math.round(W * 0.3), y: Math.round(H * 0.45) },
                widthPx: Math.round(W * 0.4),
                fontSizePx: fontSize, fontFamily: 'Inter', fontWeight: 400,
                color: d.color, backgroundColor: d.backgroundColor,
                backgroundPaddingPx: Math.round(TEXT_REF_PADDING * scale),
                backgroundRadiusPx: Math.round(TEXT_REF_RADIUS * scale),
                strokeWidthPx: 0,
            };
        }
        case 'arrow': {
            const d = overlaySettings.arrowDefaults ?? ARROW_FALLBACK;
            return {
                id, type: 'arrow',
                tail: { x: Math.round(W * 0.3), y: Math.round(H * 0.6) },
                head: { x: Math.round(W * 0.6), y: Math.round(H * 0.4) },
                color: d.color, strokeWidthPx: d.strokeWidthPx, headScale: d.headScale,
            };
        }
        case 'border': {
            const bw = Math.round(W * 0.3);
            const bh = Math.round(H * 0.25);
            const d = overlaySettings.borderDefaults ?? BORDER_FALLBACK;
            return {
                id, type: 'border',
                rectPx: { x: Math.round((W - bw) / 2), y: Math.round((H - bh) / 2), width: bw, height: bh },
                color: d.color, borderWidthPx: d.borderWidthPx, borderRadiusPx: [8, 8, 8, 8],
            };
        }
    }
};

// ============================================================================
// Numbered label helper
// ============================================================================
function getNumberedLabels(items: OverlayItem[]): Map<string, string> {
    const counters: Record<string, number> = {};
    const labels = new Map<string, string>();
    for (const item of items) {
        counters[item.type] = (counters[item.type] || 0) + 1;
        labels.set(item.id, `${OVERLAY_TYPE_LABELS[item.type]} ${counters[item.type]}`);
    }
    return labels;
}

// ============================================================================
// MAIN INSPECTOR
// ============================================================================

export const OverlayInspector: React.FC<{ block: OverlayBlock }> = ({ block }) => {
    const deleteOverlayBlock = useProjectStore(s => s.deleteOverlayBlock);
    const clearOverlayBlocks = useProjectStore(s => s.clearOverlayBlocks);
    const addOverlayItem = useProjectStore(s => s.addOverlayItem);
    const deleteOverlayItem = useProjectStore(s => s.deleteOverlayItem);
    const updateOverlayItem = useProjectStore(s => s.updateOverlayItem);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const selectOverlayBlock = useUIStore(s => s.selectOverlayBlock);
    const selectOverlayItem = useUIStore(s => s.selectOverlayItem);
    const selectedItemId = useUIStore(s => s.selectedOverlayItemId);
    const outputSize = useProjectStore(s => s.project.settings.outputSize);
    const overlaySettings = useProjectStore(s => s.project.settings.overlay) as OverlaySettings;
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const numberedLabels = useMemo(() => getNumberedLabels(block.items), [block.items]);
    const selectedItem = useMemo(() => block.items.find(i => i.id === selectedItemId), [block.items, selectedItemId]);
    const setHoveredItem = useOverlayEditorStore(s => s.setHoveredItem);
    const hoveredItemId = useOverlayEditorStore(s => s.hoveredItemId);

    const handleDelete = useCallback(() => {
        deleteOverlayBlock(block.id);
        selectOverlayBlock(null);
    }, [block.id, deleteOverlayBlock, selectOverlayBlock]);

    const handleDeleteAll = useCallback(() => {
        clearOverlayBlocks();
        selectOverlayBlock(null);
    }, [clearOverlayBlocks, selectOverlayBlock]);

    const handleAddItem = useCallback((type: OverlayItemType) => {
        const item = createDefaultItem(type, outputSize, overlaySettings);
        addOverlayItem(block.id, item);
        selectOverlayItem(item.id);
    }, [block.id, addOverlayItem, selectOverlayItem, outputSize, overlaySettings]);

    const handleDeleteItem = useCallback((itemId: string) => {
        deleteOverlayItem(block.id, itemId);
        if (selectedItemId === itemId) {
            selectOverlayItem(null);
        }
    }, [block.id, deleteOverlayItem, selectedItemId, selectOverlayItem]);

    const handleSelectItem = useCallback((itemId: string) => {
        selectOverlayItem(selectedItemId === itemId ? null : itemId);
    }, [selectedItemId, selectOverlayItem]);

    return (
        <div className="flex flex-col gap-2">
            {/* Items List */}
            <CollapsibleCard title="Items" icon={<MdLayers size={16} />} notCollapsible>
                <div className="flex flex-col gap-2">
                    {block.items.length === 0 ? (
                        <p className="subtext">No items yet. Add an overlay type below.</p>
                    ) : (
                        <div className="flex flex-col gap-1">
                            {block.items.map(item => {
                                const isSelected = selectedItemId === item.id;
                                const isHovered = hoveredItemId === item.id;
                                return (
                                    <div
                                        key={item.id}
                                        className={`flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                                            isSelected
                                                ? 'bg-primary/15 text-text-highlighted'
                                                : isHovered
                                                    ? 'bg-state-hover text-text-main'
                                                    : 'hover:bg-state-hover text-text-muted hover:text-text-main'
                                        }`}
                                        onClick={() => handleSelectItem(item.id)}
                                        onMouseEnter={() => setHoveredItem(item.id)}
                                        onMouseLeave={() => setHoveredItem(null)}
                                    >
                                        <span className="flex items-center gap-1.5 text-sm font-medium">
                                            {OVERLAY_TYPE_ICONS[item.type]}
                                            {numberedLabels.get(item.id)}
                                        </span>
                                        <button
                                            className="text-text-disabled hover:text-destructive transition-colors text-xs cursor-pointer"
                                            onClick={(e) => { e.stopPropagation(); handleDeleteItem(item.id); }}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Add overlay buttons */}
                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                        {(['blur', 'text', 'arrow', 'border'] as OverlayItemType[]).map(type => (
                            <Button key={type} size="sm" onClick={() => handleAddItem(type)}>
                                {OVERLAY_TYPE_ICONS[type]}
                                <span>{OVERLAY_TYPE_LABELS[type]}</span>
                            </Button>
                        ))}
                    </div>
                </div>
            </CollapsibleCard>

            {/* Selected Item Settings */}
            {selectedItem && (
                <CollapsibleCard
                    title={numberedLabels.get(selectedItem.id) ?? 'Settings'}
                    icon={<MdSettings size={16} />}
                    notCollapsible
                >
                    <OverlayItemSettings
                        block={block}
                        item={selectedItem}
                        overlaySettings={overlaySettings}
                        updateItem={(updates) => updateOverlayItem(block.id, selectedItem.id, updates)}
                        updateSettings={updateSettings}
                        startInteraction={startInteraction}
                        endInteraction={endInteraction}
                        batchAction={batchAction}
                        updateOverlayItem={updateOverlayItem}
                    />
                </CollapsibleCard>
            )}

            {/* Delete */}
            <div className="flex items-center gap-2 px-1">
                <Button onClick={handleDelete} size="sm" className="flex-1 text-danger hover:text-danger">
                    <span>Delete Block</span>
                </Button>
                <Button onClick={handleDeleteAll} size="sm" className="flex-1 text-danger hover:text-danger">
                    <span>Delete All</span>
                </Button>
            </div>
        </div>
    );
};

// ============================================================================
// ITEM SETTINGS — type-specific property controls
// ============================================================================

interface OverlayItemSettingsProps {
    block: OverlayBlock;
    item: OverlayItem;
    overlaySettings: OverlaySettings;
    updateItem: (updates: Partial<OverlayItem>) => void;
    updateSettings: (s: any) => void;
    startInteraction: () => void;
    endInteraction: () => void;
    batchAction: (fn: () => void) => void;
    updateOverlayItem: (blockId: string, itemId: string, updates: Partial<OverlayItem>) => void;
}

const OverlayItemSettings: React.FC<OverlayItemSettingsProps> = ({
    block, item, overlaySettings, updateItem, updateSettings,
    startInteraction, endInteraction, batchAction, updateOverlayItem,
}) => {
    // Apply-to-all state — per setting key
    const [applyAll, setApplyAll] = useState<Record<string, boolean>>({});

    // Helper: update this item + all same-type items (if apply-all) + defaults
    const updateWithApplyAll = useCallback((
        key: string,
        updates: Partial<OverlayItem>,
        defaultsUpdate?: Record<string, any>,
    ) => {
        batchAction(() => {
            updateItem(updates);

            if (applyAll[key]) {
                // Update all same-type items
                for (const other of block.items) {
                    if (other.id !== item.id && other.type === item.type) {
                        updateOverlayItem(block.id, other.id, updates);
                    }
                }
                // Update defaults for future items
                if (defaultsUpdate) {
                    const dKey = `${item.type}Defaults` as keyof OverlaySettings;
                    updateSettings({
                        overlay: {
                            ...overlaySettings,
                            [dKey]: { ...(overlaySettings[dKey] as any), ...defaultsUpdate },
                        },
                    });
                }
            }
        });
    }, [applyAll, item, block, batchAction, updateItem, updateOverlayItem, updateSettings, overlaySettings]);

    const handleToggleApplyAll = useCallback((key: string, checked: boolean) => {
        setApplyAll(prev => ({ ...prev, [key]: checked }));
    }, []);

    const typeLabel = OVERLAY_TYPE_LABELS[item.type].toLowerCase();
    const applyTooltip = `Apply to all ${typeLabel} overlays`;

    // Slider row: checkbox+label left, value right, slider below (matches ZoomInspector)
    const renderSliderRow = (
        key: string, label: string, value: number, units: string,
        sliderProps: { min: number; max: number; onChange: (v: number) => void; decimals?: number; valueTransform?: (v: number) => number },
    ) => (
        <div key={key}>
            <div className="flex justify-between items-center mb-1.5">
                <div className="flex items-center gap-1.5">
                    <Tooltip text={applyTooltip}>
                        <Checkbox
                            checked={!!applyAll[key]}
                            onChange={(v) => handleToggleApplyAll(key, v)}
                        />
                    </Tooltip>
                    <span className="text-sm text-text-muted">{label}</span>
                </div>
                <span className="text-xs text-text-muted">
                    {(sliderProps.valueTransform ? sliderProps.valueTransform(value) : value).toFixed(sliderProps.decimals ?? 0)}{units}
                </span>
            </div>
            <Slider
                value={value}
                min={sliderProps.min}
                max={sliderProps.max}
                onChange={sliderProps.onChange}
                onPointerDown={startInteraction}
                onPointerUp={endInteraction}
            />
        </div>
    );

    // Non-slider row: checkbox inline to the left of the control
    const renderRow = (key: string, control: React.ReactNode) => (
        <div key={key} className="flex items-center gap-2">
            <Tooltip text={applyTooltip}>
                <Checkbox
                    checked={!!applyAll[key]}
                    onChange={(v) => handleToggleApplyAll(key, v)}
                />
            </Tooltip>
            {control}
        </div>
    );

    switch (item.type) {
        case 'blur': {
            const blur = item as BlurOverlayItem;
            return (
                <div className="flex flex-col gap-4">
                    <p className="subtext">Check the box to apply to all blur overlays.</p>
                    {renderSliderRow('blurRadiusPx', 'Blur Amount', blur.blurRadiusPx, '%', {
                        min: 3, max: 50,
                        onChange: (v) => updateWithApplyAll('blurRadiusPx', { blurRadiusPx: v } as any, { blurRadiusPx: v }),
                        valueTransform: (v) => Math.round(10 + ((v - 3) / (50 - 3)) * 90),
                    })}
                </div>
            );
        }
        case 'text': {
            const text = item as TextOverlayItem;
            return (
                <div className="flex flex-col gap-4">
                    <p className="subtext">Check the box to apply to all text overlays.</p>
                    {renderRow('color', (
                        <ColorButton
                            title="Text" color={text.color}
                            onChange={(c) => updateWithApplyAll('color', { color: c } as any, { color: c })}
                            onPopoverOpen={startInteraction} onPopoverClose={endInteraction}
                        />
                    ))}
                    {renderRow('backgroundColor', (
                        <ColorButton
                            title="Background" color={text.backgroundColor || '#00000080'}
                            onChange={(c) => updateWithApplyAll('backgroundColor', { backgroundColor: c } as any, { backgroundColor: c })}
                            onPopoverOpen={startInteraction} onPopoverClose={endInteraction}
                            showAlpha
                        />
                    ))}
                    {renderSliderRow('fontSizePx', 'Font Size', text.fontSizePx, 'px', {
                        min: 8, max: 200,
                        onChange: (v) => updateWithApplyAll('fontSizePx', { fontSizePx: Math.round(v) } as any, { fontSizePx: Math.round(v) }),
                    })}
                </div>
            );
        }
        case 'arrow': {
            const arrow = item as ArrowOverlayItem;
            const hasShadow = !!arrow.shadow;
            return (
                <div className="flex flex-col gap-4">
                    <p className="subtext">Check the box to apply to all arrow overlays.</p>
                    {renderRow('color', (
                        <ColorButton
                            title="Color" color={arrow.color}
                            onChange={(c) => updateWithApplyAll('color', { color: c } as any, { color: c })}
                            onPopoverOpen={startInteraction} onPopoverClose={endInteraction}
                        />
                    ))}
                    {renderSliderRow('strokeWidthPx', 'Stroke Width', arrow.strokeWidthPx, '%', {
                        min: 1, max: 20,
                        onChange: (v) => updateWithApplyAll('strokeWidthPx', { strokeWidthPx: v } as any, { strokeWidthPx: v }),
                        valueTransform: (v) => Math.round(5 + ((v - 1) / 19) * 95),
                    })}
                    <MultiToggle
                        options={[
                            { value: 'shadow', label: 'Shadow' },
                            { value: 'none', label: 'None' },
                            { value: 'glow', label: 'Glow' },
                        ]}
                        value={hasShadow ? 'shadow' : arrow.glow ? 'glow' : 'none'}
                        onChange={(val) => {
                            if (val === 'shadow') {
                                updateItem({ shadow: { color: '#00000066', blurPx: 8, offsetXPx: 2, offsetYPx: 2 }, glow: undefined } as any);
                            } else if (val === 'glow') {
                                updateItem({ glow: { color: arrow.color, blurPx: 12 }, shadow: undefined } as any);
                            } else {
                                updateItem({ shadow: undefined, glow: undefined } as any);
                            }
                        }}
                    />
                </div>
            );
        }
        case 'border': {
            const border = item as BorderOverlayItem;
            return (
                <div className="flex flex-col gap-4">
                    <p className="subtext">Check the box to apply to all outline overlays.</p>
                    {renderRow('color', (
                        <ColorButton
                            title="Color" color={border.color}
                            onChange={(c) => updateWithApplyAll('color', { color: c } as any, { color: c })}
                            onPopoverOpen={startInteraction} onPopoverClose={endInteraction}
                        />
                    ))}
                    {renderSliderRow('borderWidthPx', 'Width', border.borderWidthPx, '%', {
                        min: 1, max: 20,
                        onChange: (v) => updateWithApplyAll('borderWidthPx', { borderWidthPx: v } as any, { borderWidthPx: v }),
                        valueTransform: (v) => Math.round(5 + ((v - 1) / 19) * 95),
                    })}
                    {border.fillColor !== undefined && renderRow('fillColor', (
                        <ColorButton
                            title="Fill" color={border.fillColor || '#ffffff00'}
                            onChange={(c) => updateItem({ fillColor: c } as any)}
                            onPopoverOpen={startInteraction} onPopoverClose={endInteraction}
                            showAlpha
                        />
                    ))}
                    <MultiToggle
                        options={[
                            { value: 'shadow', label: 'Shadow' },
                            { value: 'none', label: 'None' },
                            { value: 'glow', label: 'Glow' },
                        ]}
                        value={border.shadow ? 'shadow' : border.glow ? 'glow' : 'none'}
                        onChange={(val) => {
                            if (val === 'shadow') {
                                updateItem({ shadow: { color: '#00000066', blurPx: 8, offsetXPx: 2, offsetYPx: 2 }, glow: undefined } as any);
                            } else if (val === 'glow') {
                                updateItem({ glow: { color: border.color, blurPx: 12 }, shadow: undefined } as any);
                            } else {
                                updateItem({ shadow: undefined, glow: undefined } as any);
                            }
                        }}
                    />
                </div>
            );
        }
    }
};

