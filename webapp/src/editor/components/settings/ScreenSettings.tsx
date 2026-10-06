import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { ColorButton } from './ColorButton';
import { DEVICE_FRAMES } from '@shared/utils/deviceFrames';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, MultiToggle, Toggle, CollapsibleCard, type PreviewItem } from '@shared/components';
import { LuCheck, LuCrop, LuFrame, LuLaptop, LuMoon, LuPanelTop, LuScaling, LuSun } from 'react-icons/lu';
import { TbBorderOuter, TbShadow } from 'react-icons/tb';
import { DEFAULT_EFFECT_AMOUNT } from '@shared/painters/utils/outlineEffects';
import type { StyleEffect } from '@shared/types';


export const ScreenSettings = () => {
    const project = useProjectStore(s => s.project);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const canvasMode = useUIStore(s => s.canvasMode);
    const isEditingCrop = canvasMode === CanvasMode.CropEdit;
    // Personal Settings defaults template: crop is per recording (plans/user-default-project-settings)
    const templateMode = useProjectStore(s => s.templateMode);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Collapsible visibility state
    const showCollapsibleSize = useUIStore(s => s.showCollapsibleSize);
    const showCollapsibleToolbar = useUIStore(s => s.showCollapsibleToolbar);
    const showCollapsibleFrame = useUIStore(s => s.showCollapsibleFrame);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    const screenConfig = project.settings.screen;

    const handleModeChange = (mode: 'device' | 'border') => {
        updateSettings({
            screen: { ...screenConfig, mode }
        });
    };



    // Build preview items for collapsed Size state
    const sizePreviewItems: PreviewItem[] = [];
    const paddingPercent = Math.round((screenConfig.padding || 0) * 100);
    sizePreviewItems.push({ type: 'text', content: `${paddingPercent}%` });
    sizePreviewItems.push({ type: 'text', content: screenConfig.crop ? 'Cropped' : 'Full' });

    // Build preview items for collapsed frame state
    const framePreviewItems: PreviewItem[] = [];

    if (screenConfig.mode === 'device') {
        // Show device name
        const selectedDevice = DEVICE_FRAMES.find(f => f.id === screenConfig.deviceFrameId);
        if (selectedDevice) {
            framePreviewItems.push({ type: 'text', content: selectedDevice.name });
        }
    } else {
        // Border mode - show the effect, and the color when it glows
        const { borderColor = '#ffffff', effect = 'shadow', effectAmount = DEFAULT_EFFECT_AMOUNT } = screenConfig;

        if (effectAmount > 0 && effect === 'shadow') {
            framePreviewItems.push({ type: 'text', content: 'Shadow' });
        } else if (effectAmount > 0 && effect === 'glow') {
            framePreviewItems.push({
                type: 'custom',
                content: (
                    <div
                        className="w-5 h-5 rounded-full border border-border"
                        style={{ backgroundColor: borderColor }}
                    />
                )
            });
            framePreviewItems.push({ type: 'text', content: 'Glow' });
        }
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Toolbar Settings — only when viewport exists */}
            {project.screenSource.trackableContentRect && (() => {
                const toolbarEnabled = screenConfig.toolbar.enabled;

                // Preview items
                const toolbarPreviewItems: PreviewItem[] = [];
                toolbarPreviewItems.push({ type: 'text', content: toolbarEnabled ? 'On' : 'Off' });
                if (toolbarEnabled) {
                    toolbarPreviewItems.push({
                        type: 'custom',
                        content: screenConfig.toolbar.theme === 'dark'
                            ? <LuMoon className="icon-sm text-text-muted" />
                            : <LuSun className="icon-sm text-text-muted" />
                    });
                }

                return (
                    <CollapsibleCard
                        title="Toolbar"
                        icon={<LuPanelTop className="icon-md" />}
                        previewItems={toolbarPreviewItems}
                        isExpanded={showCollapsibleToolbar}
                        onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleToolbar', v)}
                    >
                        <div className="space-y-4">
                            <Toggle
                                label="Simplify Toolbar"
                                value={toolbarEnabled}
                                onChange={(val) => updateSettings({
                                    screen: { ...screenConfig, toolbar: { ...screenConfig.toolbar, enabled: val } }
                                })}
                            />

                            {/* Sub-settings for custom toolbar */}
                            {toolbarEnabled && (
                                <div className="space-y-4">
                                    <Toggle
                                        label="Dark Mode"
                                        value={screenConfig.toolbar.theme === 'dark'}
                                        onChange={(val) => updateSettings({
                                            screen: { ...screenConfig, toolbar: { ...screenConfig.toolbar, theme: val ? 'dark' : 'light' } }
                                        })}
                                    />
                                    <Toggle
                                        label="Shorten URL"
                                        value={screenConfig.toolbar.urlMode === 'short'}
                                        onChange={(val) => updateSettings({
                                            screen: { ...screenConfig, toolbar: { ...screenConfig.toolbar, urlMode: val ? 'short' : 'full' } }
                                        })}
                                    />
                                </div>
                            )}
                        </div>
                    </CollapsibleCard>
                );
            })()}

            {/* Outline Settings */}
            <CollapsibleCard
                title="Outline"
                icon={<LuFrame className="icon-md" />}
                previewItems={framePreviewItems}
                isExpanded={showCollapsibleFrame}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleFrame', v)}
            >
                <div className="space-y-4">
                    <MultiToggle
                        options={[
                            { value: 'device', label: 'Device', icon: <LuLaptop className="icon-md" /> },
                            { value: 'border', label: 'Border', icon: <TbBorderOuter className="icon-md" /> }
                        ]}
                        value={screenConfig.mode}
                        onChange={(val) => handleModeChange(val as 'device' | 'border')}
                    />

                    {/* Device Selection - Always mounted to keep images loaded */}
                    <div className={`space-y-3 ${screenConfig.mode === 'device' ? '' : 'hidden'}`}>
                        <div className="grid grid-cols-2 gap-2">
                            {DEVICE_FRAMES.map(frame => {
                                const isSelected = screenConfig.deviceFrameId === frame.id;
                                return (
                                    <div
                                        key={frame.id}
                                        onClick={() => updateSettings({
                                            screen: { ...screenConfig, deviceFrameId: frame.id }
                                        })}
                                        className={`flex flex-col gap-1 cursor-pointer rounded-md transition-all ${isSelected
                                            ? ''
                                            : 'opacity-70 hover:opacity-90'
                                            }`}
                                        title={frame.name}
                                    >
                                        <div className="w-full aspect-[16/10] flex flex-col items-center justify-center relative overflow-hidden">
                                            <img
                                                src={frame.thumbnailUrl}
                                                alt={frame.name}
                                                className={`w-full h-full object-contain p-1 transition-[filter] ${isSelected ? '' : 'grayscale'}`}
                                            />
                                        </div>
                                        <span className={`text-2xs tracking-wide text-center truncate px-1 pb-1 transition-colors ${isSelected ? 'text-on-primary' : 'text-text-main'
                                            }`}>
                                            {frame.name}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Custom Style Controls - Inlined */}
                    {screenConfig.mode === 'border' && (
                        <div className="space-y-4">
                            {/* Rounding Slider */}
                            <Slider
                                label="Rounding"
                                min={0}
                                max={200}
                                value={screenConfig.borderRadiusPx}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(val) => batchAction(() => updateSettings({
                                    screen: { ...screenConfig, borderRadiusPx: val }
                                }))}
                                showTooltip
                                units="px"
                            />

                            {/* Shadow/Glow Toggle — no effect is an amount of 0 */}
                            <MultiToggle<StyleEffect>
                                options={[
                                    { value: 'shadow', label: 'Shadow', icon: <TbShadow className="icon-md" /> },
                                    { value: 'glow', label: 'Glow', icon: <LuSun className="icon-md" /> }
                                ]}
                                value={screenConfig.effect ?? 'shadow'}
                                onChange={(val) => updateSettings({ screen: { ...screenConfig, effect: val } })}
                            />

                            {/* Glow color — the only thing the color paints */}
                            {screenConfig.effect === 'glow' && (
                                <ColorButton
                                    title="Color"
                                    color={screenConfig.borderColor}
                                    onChange={(color) => batchAction(() => updateSettings({
                                        screen: { ...screenConfig, borderColor: color }
                                    }))}
                                    onPopoverOpen={startInteraction}
                                    onPopoverClose={endInteraction}
                                    showAlpha
                                />
                            )}

                            {/* Amount of the selected effect — shadow and glow share it */}
                            <Slider
                                label="Amount"
                                min={0}
                                max={1}
                                value={screenConfig.effectAmount ?? DEFAULT_EFFECT_AMOUNT}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(val) => batchAction(() => updateSettings({
                                    screen: { ...screenConfig, effectAmount: val }
                                }))}
                                showTooltip
                                units="%"
                                decimals={0}
                                valueTransform={(v) => v * 100}
                            />
                        </div>
                    )}
                </div>
            </CollapsibleCard>

            {/* Size Settings */}
            <CollapsibleCard
                title="Size"
                icon={<LuScaling className="icon-md" />}
                previewItems={sizePreviewItems}
                isExpanded={showCollapsibleSize}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleSize', v)}
            >
                <div className="space-y-4">
                    {/* Padding Slider */}
                    <Slider
                        label="Padding"
                        min={0}
                        max={0.25}
                        value={screenConfig.padding || 0}
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(val) => batchAction(() => updateSettings({
                            screen: {
                                ...screenConfig,
                                padding: val
                            }
                        }))}
                        showTooltip
                        valueTransform={(val) => val * 100}
                        units="%"
                        decimals={0}
                    />

                    {/* Crop Screen Button — not a default (per recording) */}
                    {!templateMode && (
                        <button
                            onClick={() => setCanvasMode(isEditingCrop ? CanvasMode.Preview : CanvasMode.CropEdit)}
                            className={`interactive-base flex items-center justify-center gap-2 w-full ${isEditingCrop ? 'interactive-selected' : ''}`}
                        >
                            {isEditingCrop ? <LuCheck className="icon-md" /> : <LuCrop className="icon-md" />}
                            {isEditingCrop ? 'Done' : 'Crop Screen'}
                        </button>
                    )}

                </div>
            </CollapsibleCard>
        </div>
    );

};

