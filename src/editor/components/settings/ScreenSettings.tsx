import { useProjectStore } from '../../stores/useProjectStore';
import { StyleControls } from './StyleControls';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

export const ScreenSettings = () => {
    const project = useProjectStore(s => s.project);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const setEditingCrop = useProjectStore(s => s.setEditingCrop);
    const { startInteraction, endInteraction, updateWithBatching } = useHistoryBatcher();

    // Ensure screen settings exist (fallback for legacy projects if not fully migrated yet)
    // Default to device mode if undefined to match old behavior
    const screenConfig = project.settings.screen || {
        mode: 'device',
        deviceFrameId: 'macbook-pro',
        borderRadius: 12,
        borderWidth: 0,
        borderColor: '#ffffff',
        hasShadow: true,
        hasGlow: false
    };

    const handleModeChange = (mode: 'device' | 'border') => {
        updateSettings({
            screen: { ...screenConfig, mode }
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase">Screen Style</h3>
                <button
                    onClick={() => setEditingCrop(true)}
                    className="text-[10px] bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded transition-colors"
                >
                    Crop Video
                </button>
            </div>

            {/* Mode Toggle */}
            <div className="bg-[#1a1a1a] p-1 rounded-lg flex">
                <button
                    onClick={() => handleModeChange('device')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${screenConfig.mode === 'device'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-gray-400 hover:text-gray-200'
                        }`}
                >
                    Device Frame
                </button>
                <button
                    onClick={() => handleModeChange('border')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${screenConfig.mode === 'border'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-gray-400 hover:text-gray-200'
                        }`}
                >
                    Custom
                </button>
            </div>

            {screenConfig.mode === 'device' ? (
                /* Device Selection */
                <div className="space-y-3">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Device Frame</label>
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
                                            ? 'border-blue-500 ring-2 ring-blue-500/30 bg-white'
                                            : 'border-transparent ring-1 ring-black/5 hover:ring-black/10 bg-gray-200'
                                            }`}
                                        title={frame.name}
                                    >
                                        <img
                                            src={frame.imageUrl}
                                            alt={frame.name}
                                            className="w-full h-full object-contain p-1"
                                        />
                                    </div>
                                    <span className={`text-[10px] uppercase tracking-wide font-medium text-center truncate px-1 transition-colors ${isSelected ? 'text-blue-500' : 'text-gray-400'
                                        }`}>
                                        {frame.name}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                /* Custom Style Controls */
                <StyleControls
                    settings={{
                        borderRadius: screenConfig.borderRadius,
                        borderWidth: screenConfig.borderWidth,
                        borderColor: screenConfig.borderColor,
                        hasShadow: screenConfig.hasShadow,
                        hasGlow: screenConfig.hasGlow
                    }}
                    onChange={(updates) => updateWithBatching({
                        screen: { ...screenConfig, ...updates }
                    })}
                    onColorPopoverOpen={startInteraction}
                    onColorPopoverClose={endInteraction}
                    showRadius={true}
                />
            )}
        </div>
    );
};
