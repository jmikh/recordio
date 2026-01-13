import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { StyleControls } from './StyleControls';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider } from '../common/Slider';
import { MultiToggle } from '../common/MultiToggle';
import { LookRightButton } from './LookRightButton';
import { IoCropSharp } from 'react-icons/io5';
import { FaCheck } from 'react-icons/fa6';
import { FaVolumeOff } from 'react-icons/fa6';

export const ScreenSettings = () => {
    const project = useProjectStore(s => s.project);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const canvasMode = useUIStore(s => s.canvasMode);
    const isEditingCrop = canvasMode === CanvasMode.CropEdit;
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Ensure screen settings exist (fallback for legacy projects if not fully migrated yet)
    // Default to device mode if undefined to match old behavior
    const screenConfig = project.settings.screen || {
        mode: 'device',
        deviceFrameId: 'macbook-pro',
        borderRadius: 12,
        borderWidth: 0,
        borderColor: '#ffffff',
        hasShadow: true,
        hasGlow: false,
        padding: 0.1
    };

    const handleModeChange = (mode: 'device' | 'border') => {
        updateSettings({
            screen: { ...screenConfig, mode }
        });
    };

    return (

        <div className="space-y-6">
            {/* Area 1: Crop and Padding */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <LookRightButton
                        icon={isEditingCrop ? <FaCheck /> : <IoCropSharp className="w-5 h-5" />}
                        isActive={isEditingCrop}
                        onClick={() => setCanvasMode(isEditingCrop ? CanvasMode.Preview : CanvasMode.CropEdit)}
                        label={isEditingCrop ? 'Done Cropping' : 'Crop Video'}
                        className="w-auto px-6"
                    />
                </div>

                <Slider
                    label="Padding"
                    min={0}
                    max={0.2}
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
                    decimals={2}
                />
            </div>

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-text-secondary">
                    <FaVolumeOff className="w-4 h-4" />
                    <span className="text-xs font-medium select-none">Mute Screen Audio</span>
                </div>

                <button
                    onClick={() => updateSettings({
                        screen: { ...screenConfig, mute: !screenConfig.mute }
                    })}
                    className={`h-5 w-9 rounded-full p-0.5 transition-colors relative border border-border ${screenConfig.mute ? 'bg-primary border-primary' : 'bg-surface-elevated'
                        }`}
                >
                    <div className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${screenConfig.mute ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                </button>
            </div>

            <div className="border-t border-gray-700" />

            {/* Area 2: Framing */}
            <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-2 text-center">Framing</label>
                <MultiToggle
                    options={[
                        { value: 'device', label: 'Device' },
                        { value: 'border', label: 'Border' }
                    ]}
                    value={screenConfig.mode}
                    onChange={(val) => handleModeChange(val as any)}
                    className="mb-4"
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
                                        className={`cursor-pointer w-full aspect-[16/10] rounded-lg border-2 flex flex-col items-center justify-center relative overflow-hidden transition-all  ${isSelected
                                            ? 'border-settings-primary ring-2 ring-settings-primary/30 bg-white'
                                            : 'border-transparent ring-1 ring-black/5 hover:ring-black/10 bg-gray-200'
                                            }`}
                                        title={frame.name}
                                    >
                                        <img
                                            src={frame.thumbnailUrl}
                                            alt={frame.name}
                                            className="w-full h-full object-contain p-1"
                                        />
                                    </div>
                                    <span className={`text-[10px] tracking-wide text-center truncate px-1 transition-colors ${isSelected ? 'text-settings-primary' : 'text-gray-400'
                                        }`}>
                                        {frame.name}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Custom Style Controls */}
                {screenConfig.mode === 'border' && (
                    <StyleControls
                        settings={{
                            borderRadius: screenConfig.borderRadius,
                            borderWidth: screenConfig.borderWidth,
                            borderColor: screenConfig.borderColor,
                            hasShadow: screenConfig.hasShadow,
                            hasGlow: screenConfig.hasGlow
                        }}
                        onChange={(updates) => batchAction(() => updateSettings({
                            screen: { ...screenConfig, ...updates }
                        }))}
                        onColorPopoverOpen={startInteraction}
                        onColorPopoverClose={endInteraction}
                        showRadius={true}
                        onInteractionStart={startInteraction}
                        onInteractionEnd={endInteraction}
                    />
                )}
            </div>
        </div>
    );

};
