import React, { useCallback, useMemo } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { CollapsibleCard, Button, Slider, MultiToggle, Tooltip } from '@shared/components';
import { ColorButton } from './ColorButton';
import { MdBlurOn, MdOutlineTextFields, MdBorderOuter } from 'react-icons/md';
import { LuLayers3 } from 'react-icons/lu';
import { RiArrowRightUpFill } from 'react-icons/ri';
import type { OverlaySegment, OverlayItem, OverlayItemType, BlurOverlayItem, TextOverlayItem, ArrowOverlayItem, BorderOverlayItem } from '../../../types/overlay';
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
const TEXT_FALLBACK = { color: '#454545', backgroundColor: '#ffdb57', fontSizePx: 0 };
const ARROW_FALLBACK = { color: '#7B61FF', strokeWidthPx: 4 };
const BORDER_FALLBACK = { color: '#7B61FF', borderWidthPx: 4 };

export const createDefaultItem = (type: OverlayItemType, outputSize: Size, overlaySettings: OverlaySettings): OverlayItem => {
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
            const fontSize = d.fontSizePx > 0 ? d.fontSizePx : Math.round(Math.min(W, H) * 0.025);
            return {
                id, type: 'text', text: 'Text',
                topLeft: { x: Math.round(W * 0.3), y: Math.round(H * 0.45) },
                widthPx: Math.round(W * 0.2),
                fontSizePx: fontSize, fontFamily: 'Inter', fontWeight: 400,
                color: d.color, backgroundColor: d.backgroundColor,
            };
        }
        case 'arrow': {
            const d = overlaySettings.arrowDefaults ?? ARROW_FALLBACK;
            return {
                id, type: 'arrow',
                tail: { x: Math.round(W * 0.3), y: Math.round(H * 0.6) },
                head: { x: Math.round(W * 0.6), y: Math.round(H * 0.4) },
                color: d.color, strokeWidthPx: d.strokeWidthPx,
                effect: 'none',
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
                effect: 'none',
            };
        }
    }
};

// ============================================================================
// MAIN INSPECTOR
// ============================================================================

export const OverlayInspector: React.FC<{ block: OverlaySegment }> = ({ block }) => {
    const deleteOverlaySegment = useProjectStore(s => s.deleteOverlaySegment);
    const clearOverlaySegments = useProjectStore(s => s.clearOverlaySegments);
    const updateOverlayItemData = useProjectStore(s => s.updateOverlayItemData);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const selectOverlaySegment = useUIStore(s => s.selectOverlaySegment);
    const outputSize = useProjectStore(s => s.project.settings.outputSize);
    const overlaySettings = useProjectStore(s => s.project.settings.overlay) as OverlaySettings;
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const item = block.item;

    const handleDelete = useCallback(() => {
        deleteOverlaySegment(block.id);
        selectOverlaySegment(null);
    }, [block.id, deleteOverlaySegment, selectOverlaySegment]);

    const handleDeleteAll = useCallback(() => {
        clearOverlaySegments();
        selectOverlaySegment(null);
    }, [clearOverlaySegments, selectOverlaySegment]);

    const handleChangeType = useCallback((newType: OverlayItemType) => {
        if (newType === item.type) return;
        // Replace the item with a new default of the selected type
        const newItem = createDefaultItem(newType, outputSize, overlaySettings);
        updateOverlayItemData(block.id, newItem);
    }, [item.type, block.id, outputSize, overlaySettings, updateOverlayItemData]);

    const handleUpdateItem = useCallback((updates: Partial<OverlayItem>) => {
        updateOverlayItemData(block.id, updates);
    }, [block.id, updateOverlayItemData]);

    return (
        <div className="flex flex-col gap-2">
            {/* Type Selector */}
            <CollapsibleCard title={OVERLAY_TYPE_LABELS[item.type]} icon={OVERLAY_TYPE_ICONS[item.type]} notCollapsible>
                <div className="flex flex-col gap-2">
                    <p className="subtext">Change overlay type:</p>
                    <div className="grid grid-cols-2 gap-1.5">
                        {(['blur', 'text', 'arrow', 'border'] as OverlayItemType[]).map(type => (
                            <Button
                                key={type}
                                size="sm"
                                variant={item.type === type ? 'primary' : undefined}
                                onClick={() => handleChangeType(type)}
                            >
                                {OVERLAY_TYPE_ICONS[type]}
                                <span>{OVERLAY_TYPE_LABELS[type]}</span>
                            </Button>
                        ))}
                    </div>
                </div>
            </CollapsibleCard>

            {/* Item Settings */}
            <CollapsibleCard
                title="Settings"
                icon={OVERLAY_TYPE_ICONS[item.type]}
                notCollapsible
            >
                <OverlayItemSettings
                    block={block}
                    item={item}
                    overlaySettings={overlaySettings}
                    updateItem={handleUpdateItem}
                    updateSettings={updateSettings}
                    startInteraction={startInteraction}
                    endInteraction={endInteraction}
                    batchAction={batchAction}
                />
            </CollapsibleCard>

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
    block: OverlaySegment;
    item: OverlayItem;
    overlaySettings: OverlaySettings;
    updateItem: (updates: Partial<OverlayItem>) => void;
    updateSettings: (s: any) => void;
    startInteraction: () => void;
    endInteraction: () => void;
    batchAction: (fn: () => void) => void;
}

const OverlayItemSettings: React.FC<OverlayItemSettingsProps> = ({
    block, item, overlaySettings, updateItem, updateSettings,
    startInteraction, endInteraction, batchAction,
}) => {
    // Slider row: label left, value right, slider below
    const renderSliderRow = (
        key: string, label: string, value: number, units: string,
        sliderProps: { min: number; max: number; onChange: (v: number) => void; decimals?: number; valueTransform?: (v: number) => number },
    ) => (
        <div key={key}>
            <div className="flex justify-between items-center mb-1.5">
                <span className="text-sm text-text-muted">{label}</span>
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

    switch (item.type) {
        case 'blur': {
            const blur = item as BlurOverlayItem;
            return (
                <div className="flex flex-col gap-4">
                    {renderSliderRow('blurRadiusPx', 'Blur Amount', blur.blurRadiusPx, '%', {
                        min: 3, max: 50,
                        onChange: (v) => {
                            batchAction(() => updateItem({ blurRadiusPx: v } as any));
                        },
                        valueTransform: (v) => Math.round(10 + ((v - 3) / (50 - 3)) * 90),
                    })}
                </div>
            );
        }
        case 'text': {
            const text = item as TextOverlayItem;
            return (
                <div className="flex flex-col gap-4">
                    <ColorButton
                        title="Text" color={text.color}
                        onChange={(c) => updateItem({ color: c } as any)}
                        onPopoverOpen={startInteraction} onPopoverClose={endInteraction}
                    />
                    <ColorButton
                        title="Background" color={text.backgroundColor || '#00000080'}
                        onChange={(c) => updateItem({ backgroundColor: c } as any)}
                        onPopoverOpen={startInteraction} onPopoverClose={endInteraction}
                        showAlpha
                    />
                    {renderSliderRow('fontSizePx', 'Font Size', text.fontSizePx, 'px', {
                        min: 8, max: 200,
                        onChange: (v) => {
                            batchAction(() => updateItem({ fontSizePx: Math.round(v) } as any));
                        },
                    })}
                </div>
            );
        }
        case 'arrow': {
            const arrow = item as ArrowOverlayItem;
            return (
                <div className="flex flex-col gap-4">
                    <ColorButton
                        title="Color" color={arrow.color}
                        onChange={(c) => updateItem({ color: c } as any)}
                        onPopoverOpen={startInteraction} onPopoverClose={endInteraction}
                    />
                    {renderSliderRow('strokeWidthPx', 'Stroke Width', arrow.strokeWidthPx, '%', {
                        min: 1, max: 20,
                        onChange: (v) => {
                            batchAction(() => updateItem({ strokeWidthPx: v } as any));
                        },
                        valueTransform: (v) => Math.round(5 + ((v - 1) / 19) * 95),
                    })}
                    <MultiToggle
                        options={[
                            { value: 'shadow', label: 'Shadow' },
                            { value: 'none', label: 'None' },
                            { value: 'glow', label: 'Glow' },
                        ]}
                    value={arrow.effect}
                        onChange={(val) => {
                            updateItem({ effect: val } as any);
                        }}
                    />
                </div>
            );
        }
        case 'border': {
            const border = item as BorderOverlayItem;
            return (
                <div className="flex flex-col gap-4">
                    <ColorButton
                        title="Color" color={border.color}
                        onChange={(c) => updateItem({ color: c } as any)}
                        onPopoverOpen={startInteraction} onPopoverClose={endInteraction}
                    />
                    {renderSliderRow('borderWidthPx', 'Width', border.borderWidthPx, '%', {
                        min: 1, max: 20,
                        onChange: (v) => {
                            batchAction(() => updateItem({ borderWidthPx: v } as any));
                        },
                        valueTransform: (v) => Math.round(5 + ((v - 1) / 19) * 95),
                    })}
                    {border.fillColor !== undefined && (
                        <ColorButton
                            title="Fill" color={border.fillColor || '#ffffff00'}
                            onChange={(c) => updateItem({ fillColor: c } as any)}
                            onPopoverOpen={startInteraction} onPopoverClose={endInteraction}
                            showAlpha
                        />
                    )}
                    <MultiToggle
                        options={[
                            { value: 'shadow', label: 'Shadow' },
                            { value: 'none', label: 'None' },
                            { value: 'glow', label: 'Glow' },
                        ]}
                        value={border.effect}
                        onChange={(val) => {
                            updateItem({ effect: val } as any);
                        }}
                    />
                </div>
            );
        }
    }
};
