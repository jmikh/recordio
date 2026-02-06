import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { ColorButton } from './ColorButton';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, MultiToggle, CollapsibleCard, Dropdown, DefaultButton, type PreviewItem, type DropdownOption } from '@shared/components';
import { IoCropSharp } from 'react-icons/io5';

interface Resolution {
    label: string;
    width: number;
    height: number;
}

const RESOLUTIONS: Resolution[] = [
    { label: '1:1', width: 1080 * 2, height: 1080 * 2 },
    { label: '4:3', width: 1440 * 2, height: 1080 * 2 },
    { label: '16:9', width: 1920 * 2, height: 1080 * 2 },
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
        const { borderWidth = 0, borderColor = '#ffffff', hasGlow = false, hasShadow = false } = screenConfig;

        // Only show color if there's a visible border or glow effect
        if (borderWidth > 0 || hasGlow) {
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
        if (borderWidth > 0) {
            framePreviewItems.push({ type: 'text', content: `${Math.round(borderWidth)}px` });
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
                        <IoCropSharp className="w-4 h-4" />
                        {isEditingCrop ? 'Done Cropping' : 'Crop Screen'}
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

            {/* Area 2: Frame Settings */}
            <CollapsibleCard
                title="Frame"
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
                        onChange={(val) => handleModeChange(val as any)}
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
                            />

                            {/* Rounding Slider */}
                            <Slider
                                label="Rounding"
                                min={0}
                                max={200}
                                value={screenConfig.borderRadius}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(val) => batchAction(() => updateSettings({
                                    screen: { ...screenConfig, borderRadius: val }
                                }))}
                                showTooltip
                                units="px"
                            />

                            {/* Thickness Slider */}
                            <Slider
                                label="Thickness"
                                min={0}
                                max={20}
                                value={screenConfig.borderWidth}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(val) => batchAction(() => updateSettings({
                                    screen: { ...screenConfig, borderWidth: val }
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

