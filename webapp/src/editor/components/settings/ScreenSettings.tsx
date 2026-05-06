import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { ColorButton } from './ColorButton';
import { DEVICE_FRAMES } from '@shared/utils/deviceFrames';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, MultiToggle, Toggle, CollapsibleCard, type PreviewItem } from '@shared/components';
import { IoCropSharp } from 'react-icons/io5';
import { LuCheck } from 'react-icons/lu';
import { MdDarkMode, MdLightMode } from 'react-icons/md';
import { CgToolbarTop } from 'react-icons/cg';
import { TbResize, TbFrame } from 'react-icons/tb';


export const ScreenSettings = () => {
    const project = useProjectStore(s => s.project);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const canvasMode = useUIStore(s => s.canvasMode);
    const isEditingCrop = canvasMode === CanvasMode.CropEdit;
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
        // Border mode - show color (only if glow or border > 0), thickness, and effect
        const { borderWidthPx = 0, borderColor = '#ffffff', hasGlow = false, hasShadow = false } = screenConfig;

        // Only show color if there's a visible border or glow effect
        if (borderWidthPx > 0 || hasGlow) {
            framePreviewItems.push({
                type: 'custom',
                content: (
                    <div
                        className="w-5 h-5 rounded-full border border-border"
                        style={{ backgroundColor: borderColor }}
                    />
                )
            });
        }

        // Only show pixel count if there's a border
        if (borderWidthPx > 0) {
            framePreviewItems.push({ type: 'text', content: `${Math.round(borderWidthPx)}px` });
        }

        // Add effect type (shadow/glow) only if enabled
        if (hasShadow) {
            framePreviewItems.push({ type: 'text', content: 'Shadow' });
        } else if (hasGlow) {
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
                            ? <MdDarkMode className="icon-sm text-text-muted" />
                            : <MdLightMode className="icon-sm text-text-muted" />
                    });
                }

                return (
                    <CollapsibleCard
                        title="Toolbar"
                        icon={<CgToolbarTop className="icon-md" />}
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

            {/* Frame Settings */}
            <CollapsibleCard
                title="Frame"
                icon={<TbFrame className="icon-md" />}
                previewItems={framePreviewItems}
                isExpanded={showCollapsibleFrame}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleFrame', v)}
            >
                <div className="space-y-4">
                    <MultiToggle
                        options={[
                            { value: 'device', label: 'Device' },
                            { value: 'border', label: 'Border' }
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
                                        <span className={`text-[10px] tracking-wide text-center truncate px-1 pb-1 transition-colors ${isSelected ? 'text-on-primary' : 'text-text-main'
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
                            {/* Color Picker */}
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

                            {/* Thickness Slider */}
                            <Slider
                                label="Thickness"
                                min={0}
                                max={20}
                                value={screenConfig.borderWidthPx}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(val) => batchAction(() => updateSettings({
                                    screen: { ...screenConfig, borderWidthPx: val }
                                }))}
                                showTooltip
                                units="px"
                            />

                            {/* Shadow/Glow Toggle */}
                            <MultiToggle
                                options={[
                                    { value: 'shadow', label: 'Shadow' },
                                    { value: 'none', label: 'None' },
                                    { value: 'glow', label: 'Glow' }
                                ]}
                                value={screenConfig.hasShadow ? 'shadow' : screenConfig.hasGlow ? 'glow' : 'none'}
                                onChange={(val) => {
                                    if (val === 'shadow') {
                                        batchAction(() => updateSettings({ screen: { ...screenConfig, hasShadow: true, hasGlow: false } }));
                                    } else if (val === 'glow') {
                                        batchAction(() => updateSettings({ screen: { ...screenConfig, hasShadow: false, hasGlow: true } }));
                                    } else {
                                        batchAction(() => updateSettings({ screen: { ...screenConfig, hasShadow: false, hasGlow: false } }));
                                    }
                                }}
                            />
                        </div>
                    )}
                </div>
            </CollapsibleCard>

            {/* Size Settings */}
            <CollapsibleCard
                title="Size"
                icon={<TbResize className="icon-md" />}
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

                    {/* Crop Screen Button */}
                    <button
                        onClick={() => setCanvasMode(isEditingCrop ? CanvasMode.Preview : CanvasMode.CropEdit)}
                        className={`interactive-base flex items-center justify-center gap-2 w-full ${isEditingCrop ? 'interactive-selected' : ''}`}
                    >
                        {isEditingCrop ? <LuCheck /> : <IoCropSharp className="w-4 h-4" />}
                        {isEditingCrop ? 'Done' : 'Crop Screen'}
                    </button>

                </div>
            </CollapsibleCard>
        </div>
    );

};

