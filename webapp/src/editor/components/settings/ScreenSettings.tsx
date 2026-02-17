import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { ColorButton } from './ColorButton';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, MultiToggle, Toggle, CollapsibleCard, Dropdown, DefaultButton, type PreviewItem, type DropdownOption } from '@shared/components';
import { IoCropSharp } from 'react-icons/io5';
import { FaCheck } from 'react-icons/fa';
import { MdDarkMode, MdLightMode } from 'react-icons/md';

interface Resolution {
    label: string;
    width: number;
    height: number;
    orientation?: string;
}

const RESOLUTIONS: Resolution[] = [
    { label: '1:1', width: 1080 * 2, height: 1080 * 2 },
    { label: '4:3', width: 1440 * 2, height: 1080 * 2, orientation: 'Horizontal' },
    { label: '16:9', width: 1920 * 2, height: 1080 * 2, orientation: 'Horizontal' },
    { label: '3:4', width: 1080 * 2, height: 1440 * 2, orientation: 'Vertical' },
    { label: '9:16', width: 1080 * 2, height: 1920 * 2, orientation: 'Vertical' },
];

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

    // Current resolution
    const currentResolution = project.settings.outputSize;
    const currentResolutionObj = RESOLUTIONS.find(
        r => r.width === currentResolution?.width && r.height === currentResolution?.height
    ) || RESOLUTIONS[2]; // Default to 16:9

    const resolutionOptions: DropdownOption<Resolution>[] = RESOLUTIONS.map(res => ({
        value: res,
        label: res.label,
        suffix: res.orientation ? <span className="text-text-muted text-xs">{res.orientation}</span> : undefined,
    }));

    const handleResolutionChange = (resolution: Resolution) => {
        updateSettings({ outputSize: { width: resolution.width, height: resolution.height } });
    };

    // Build preview items for collapsed Size state
    const sizePreviewItems: PreviewItem[] = [];
    sizePreviewItems.push({ type: 'text', content: currentResolutionObj.label });
    const paddingPercent = Math.round((screenConfig.padding || 0) * 100);
    if (paddingPercent > 0) {
        sizePreviewItems.push({ type: 'text', content: `${paddingPercent}%` });
    }
    if (screenConfig.crop) {
        sizePreviewItems.push({ type: 'text', content: 'Cropped' });
    }

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
            {/* Area 1: Size Settings */}
            <CollapsibleCard
                title="Size"
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
                    <DefaultButton
                        onClick={() => setCanvasMode(isEditingCrop ? CanvasMode.Preview : CanvasMode.CropEdit)}
                        className={`w-full ${isEditingCrop ? 'interactive-selected' : ''}`}
                    >
                        {isEditingCrop ? <FaCheck /> : <IoCropSharp className="w-4 h-4" />}
                        {isEditingCrop ? 'Done' : 'Crop Screen'}
                    </DefaultButton>

                    {/* Aspect Ratio Dropdown */}
                    <Dropdown
                        options={resolutionOptions}
                        value={currentResolutionObj}
                        onChange={handleResolutionChange}
                        label="Aspect Ratio"
                    />

                </div>
            </CollapsibleCard>

            {/* Area 2: Toolbar Settings — only when viewport exists */}
            {project.screenSource.trackableContentRect && (() => {
                const toolbarEnabled = screenConfig.toolbar.enabled;

                // Preview items
                const toolbarPreviewItems: PreviewItem[] = [];
                toolbarPreviewItems.push({ type: 'text', content: toolbarEnabled ? 'On' : 'Off' });
                if (toolbarEnabled) {
                    toolbarPreviewItems.push({
                        type: 'custom',
                        content: screenConfig.toolbar.theme === 'dark'
                            ? <MdDarkMode size={14} className="text-text-muted" />
                            : <MdLightMode size={14} className="text-text-muted" />
                    });
                }

                return (
                    <CollapsibleCard
                        title="Toolbar"
                        previewItems={toolbarPreviewItems}
                        isExpanded={showCollapsibleToolbar}
                        onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleToolbar', v)}
                    >
                        <div className="space-y-4">
                            <Toggle
                                label="Custom Toolbar"
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

            {/* Area 2: Frame Settings */}
            <CollapsibleCard
                title="Frame"
                previewItems={framePreviewItems}
                isExpanded={showCollapsibleFrame}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleFrame', v)}
            >
                <div className="space-y-4">
                    <Toggle
                        label="Device Frame"
                        value={screenConfig.mode === 'device'}
                        onChange={(val) => handleModeChange(val ? 'device' : 'border')}
                    />

                    {/* Device Selection - Always mounted to keep images loaded */}
                    <div className={`space-y-3 ${screenConfig.mode === 'device' ? '' : 'hidden'}`}>
                        <div className="grid grid-cols-2 gap-2">
                            {DEVICE_FRAMES.map(frame => {
                                const isSelected = screenConfig.deviceFrameId === frame.id;
                                return (
                                    <div key={frame.id} className="flex flex-col gap-1">
                                        <div
                                            onClick={() => updateSettings({
                                                screen: { ...screenConfig, deviceFrameId: frame.id }
                                            })}
                                            className={`cursor-pointer w-full aspect-[16/10] rounded-md flex flex-col items-center justify-center relative overflow-hidden transition-all  ${isSelected
                                                ? 'ring-2 ring-offset-2 ring-offset-surface ring-primary bg-white'
                                                : 'ring-1 ring-black/5 hover:ring-black/10 bg-white/70 hover:bg-white/85'
                                                }`}
                                            title={frame.name}
                                        >
                                            <img
                                                src={frame.thumbnailUrl}
                                                alt={frame.name}
                                                className="w-full h-full object-contain p-1"
                                            />
                                        </div>
                                        <span className={`text-[10px] tracking-wide text-center truncate px-1 transition-colors ${isSelected ? 'text-on-primary' : 'text-text-main'
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
        </div>
    );

};

