import { useRef } from 'react';
import { useProjectStore, useProjectData, useProjectSources } from '../../stores/useProjectStore';

const BACKGROUND_IMAGES = [
    { name: 'Abstract Gradient', url: '/assets/backgrounds/abstract-gradient.jpg' },
    // Add more here if needed
];

export const BackgroundSettings = () => {
    const project = useProjectData();
    const updateSettings = useProjectStore(s => s.updateSettings);
    const addSource = useProjectStore(s => s.addSource);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Defensive check
    if (!project) return null;

    const sources = useProjectSources();
    const { settings } = project;
    const { backgroundType, backgroundColor, backgroundImageUrl, backgroundSourceId, customBackgroundSourceId } = settings;

    // Helpers to determine active state
    const isSolid = backgroundType === 'solid';
    const isPreset = backgroundType === 'image' && !backgroundSourceId && !!backgroundImageUrl;

    // Check if active source matches the custom source (or just valid custom source is active)
    const isCustom = backgroundType === 'image' && !!backgroundSourceId;

    const handleColorChange = (color: string) => {
        updateSettings({
            backgroundType: 'solid',
            backgroundColor: color
        });
    };

    const handlePresetSelect = (url: string) => {
        updateSettings({
            backgroundType: 'image',
            backgroundImageUrl: url,
            backgroundSourceId: undefined // Clear source ID
        });
    };

    const handleCustomSelect = () => {
        if (customBackgroundSourceId) {
            updateSettings({
                backgroundType: 'image',
                backgroundSourceId: customBackgroundSourceId
            });
        } else {
            fileInputRef.current?.click();
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const newSourceId = await addSource(file, 'image');
            updateSettings({
                backgroundType: 'image',
                backgroundSourceId: newSourceId,
                customBackgroundSourceId: newSourceId
            });
        } catch (err) {
            console.error("Failed to upload background", err);
        } finally {
            // Reset input so same file can be selected again if needed
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const customSource = customBackgroundSourceId ? sources[customBackgroundSourceId] : null;

    return (
        <div className="flex flex-col gap-6">
            {/* 1. Solid Color */}
            <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Solid Color</label>
                <div
                    className={`flex items-center gap-3 p-2 rounded border cursor-pointer transition-colors ${isSolid ? 'border-blue-500 bg-[#2a2a2a]' : 'border-transparent hover:bg-[#2a2a2a]'}`}
                    onClick={() => handleColorChange(backgroundColor)}
                >
                    <input
                        type="color"
                        value={backgroundColor}
                        onChange={(e) => handleColorChange(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                    />
                    <span className="text-xs font-mono text-gray-300">{backgroundColor}</span>
                </div>
            </div>

            {/* 2. Presets */}
            <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Presets</label>
                <div className="grid grid-cols-2 gap-3">
                    {BACKGROUND_IMAGES.map(img => {
                        const isActive = isPreset && backgroundImageUrl === img.url;
                        return (
                            <div
                                key={img.url}
                                className={`cursor-pointer border-2 rounded-lg overflow-hidden aspect-video relative group transition-all ${isActive ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-transparent hover:border-gray-500'}`}
                                onClick={() => handlePresetSelect(img.url)}
                            >
                                <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 3. Custom Upload */}
            <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Custom Upload</label>
                <div
                    className={`cursor-pointer border-2 rounded-lg overflow-hidden aspect-video flex items-center justify-center bg-[#1e1e1e] relative transition-all ${isCustom ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-dashed border-gray-600 hover:border-gray-400 hover:bg-[#252525]'}`}
                    onClick={handleCustomSelect}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={handleUpload}
                    />

                    {customSource ? (
                        <div className="w-full h-full relative group">
                            <img src={customSource.url} className="w-full h-full object-cover" />
                            {/* Change Overlay */}
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-sm">
                                <button
                                    className="text-xs text-white bg-white/10 px-3 py-1.5 rounded hover:bg-white/20 transition-colors"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        fileInputRef.current?.click();
                                    }}
                                >
                                    Change Image
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 text-gray-500 group-hover:text-gray-300 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                            <span className="text-xs font-medium">Upload Image</span>
                        </div>
                    )}
                </div>
            </div>

            {/* 4. Effects */}
            <div className="flex flex-col gap-4 pt-4 border-t border-gray-700">
                {/* Padding */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Spacing</label>
                    <input
                        type="range"
                        min={0}
                        max={0.25}
                        step={0.01}
                        value={settings.padding}
                        onChange={(e) => updateSettings({ padding: parseFloat(e.target.value) })}
                        className="w-full accent-blue-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                </div>

                {/* Corner Radius */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Rounding</label>
                    <input
                        type="range"
                        min={0}
                        max={60}
                        step={1}
                        value={settings.cornerRadius || 0}
                        onChange={(e) => updateSettings({ cornerRadius: parseInt(e.target.value) })}
                        className="w-full accent-blue-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                </div>

                {/* Blur */}
                <div className={`flex flex-col gap-2 transition-opacity ${settings.backgroundType === 'solid' ? 'opacity-40 pointer-events-none' : ''}`}>
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Blur</label>
                    <input
                        type="range"
                        min={0}
                        max={20}
                        step={1}
                        value={settings.backgroundBlur || 0}
                        onChange={(e) => updateSettings({ backgroundBlur: parseInt(e.target.value) })}
                        className="w-full accent-blue-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                </div>
            </div>
        </div>
    );
};
