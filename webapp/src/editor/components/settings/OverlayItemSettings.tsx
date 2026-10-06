import React from 'react';
import { Slider, MultiToggle } from '@shared/components';
import { ColorButton } from './ColorButton';
import type { OverlayItem, BlurOverlayItem, TextOverlayItem, ArrowOverlayItem, BorderOverlayItem } from '@shared/types/overlay';
import type { AnnotationDefaults } from '@shared/types/screenshot';

// ============================================================================
// ITEM SETTINGS — type-specific property controls for an annotation item.
// Store-free; hosted by the screenshot inspector (plans/screenshots).
// ============================================================================

export interface OverlayItemSettingsProps {
    item: OverlayItem;
    overlaySettings: AnnotationDefaults;
    updateItem: (updates: Partial<OverlayItem>) => void;
    startInteraction: () => void;
    endInteraction: () => void;
    batchAction: (fn: () => void) => void;
}

export const OverlayItemSettings: React.FC<OverlayItemSettingsProps> = ({
    item, updateItem,
    startInteraction, endInteraction, batchAction,
}) => {
    // Slider row: label left, value right, slider below
    const renderSliderRow = (
        key: string, label: string, value: number, units: string,
        sliderProps: { min: number; max: number; onChange: (v: number) => void; decimals?: number; valueTransform?: (v: number) => number },
    ) => (
        <div key={key}>
            <div className="flex justify-between items-center mb-1.5">
                <span className="text-label">{label}</span>
                <span className="text-label">
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
