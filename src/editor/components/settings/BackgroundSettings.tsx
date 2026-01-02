import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore, useProjectData, useProjectSources } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';
import { ColorSettings } from './ColorSettings';

// Helper to convert N, NE, etc. to degrees
const getGradientAngle = (dir: string) => {
    switch (dir) {
        case 'N': return 0;
        case 'NE': return 45;
        case 'E': return 90;
        case 'SE': return 135;
        case 'S': return 180;
        case 'SW': return 225;
        case 'W': return 270;
        case 'NW': return 315;
        default: return 180;
    }
};

const BACKGROUND_IMAGES = [
    { name: 'Background 1', url: '/assets/backgrounds/bg1.jpg' },
    { name: 'Background 2', url: '/assets/backgrounds/bg2.jpg' },
    { name: 'Background 3', url: '/assets/backgrounds/bg3.jpg' },
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
    const isGradient = backgroundType === 'gradient';
    const isColorMode = isSolid || isGradient;

    // Preset active if image mode AND no source ID (implies generic url) AND url matches
    const isPreset = backgroundType === 'image' && !backgroundSourceId && !!backgroundImageUrl;

    // Custom active if image mode AND source ID present
    const isCustom = backgroundType === 'image' && !!backgroundSourceId;

    // --- Undo/Redo Batching Helpers ---
    const { startInteraction, endInteraction, updateWithBatching } = useHistoryBatcher();

    // Track last active color mode to restore it when switching back from Image
    // Now stored in settings.lastColorMode (persisted) instead of ref (ephemeral)

    const handleColorTypeChange = (type: 'solid' | 'gradient') => {
        updateSettings({
            backgroundType: type,
            lastColorMode: type,
            // Initialize gradient if missing
            backgroundGradient: settings.backgroundGradient || { colors: ['#ffffff', '#000000'], direction: 'S' }
        });
    };

    const handleColorChange = (color: string) => {
        updateWithBatching({
            backgroundColor: color
        });
    };

    const handleGradientColorChange = (index: 0 | 1, color: string) => {
        const current = settings.backgroundGradient || { colors: ['#ffffff', '#000000'], direction: 'S' };
        const newColors = [...current.colors] as [string, string];
        newColors[index] = color;

        updateWithBatching({
            backgroundGradient: { ...current, colors: newColors }
        });
    };

    const handleDirectionChange = (direction: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW') => {
        const current = settings.backgroundGradient || { colors: ['#ffffff', '#000000'], direction: 'S' };
        updateSettings({
            backgroundGradient: { ...current, direction }
        });
    };

    const handlePresetSelect = (url: string) => {
        updateSettings({
            backgroundType: 'image',
            backgroundImageUrl: url,
            backgroundSourceId: undefined
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
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const customSource = customBackgroundSourceId ? sources[customBackgroundSourceId] : null;

    // Popover State
    const [showColorPopover, setShowColorPopover] = useState(false);
    const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
    const popoverRef = useRef<HTMLDivElement>(null);
    const colorButtonRef = useRef<HTMLDivElement>(null);

    // Close popover on click outside or scroll
    useEffect(() => {
        if (showColorPopover && colorButtonRef.current) {
            const rect = colorButtonRef.current.getBoundingClientRect();
            // Position to the right of the button, centered vertically if possible, or just aligned top
            // Let's try aligned top-right of the button
            const TOP_OFFSET = -20;
            const LEFT_OFFSET = 60; // 48px width + gap

            setPopoverPos({
                top: rect.top + window.scrollY + TOP_OFFSET,
                left: rect.left + window.scrollX + LEFT_OFFSET
            });
        }

        const handleClickOutside = (event: Event) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node) &&
                colorButtonRef.current && !colorButtonRef.current.contains(event.target as Node)) {
                setShowColorPopover(false);
            }
        };

        if (showColorPopover) {
            document.addEventListener('mousedown', handleClickOutside);
            window.addEventListener('scroll', handleClickOutside, true);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleClickOutside, true);
        };
    }, [showColorPopover]);

    // Determine intent for preview and restore
    const lastMode = settings.lastColorMode || 'solid';
    const showSolidPreview = isSolid || (!isColorMode && lastMode === 'solid');

    // Dynamic background style for the Color Card
    // User requested "two half circles" for gradient mode (hard stop), not smooth gradient
    // Wait, the previous logic: "isColorMode && !settings.backgroundGradient" might be flawed if gradient exists.
    // Let's stick to the simpler check: Do we want to show solid?
    // If current is solid: YES.
    // If current is Image: Show whatever lastMode was.
    // If current is Gradient: NO.

    const colorCardStyle: React.CSSProperties = showSolidPreview
        ? { backgroundColor: backgroundColor }
        : {
            backgroundImage: `linear-gradient(${getGradientAngle(settings.backgroundGradient?.direction || 'S')}deg, ${settings.backgroundGradient?.colors[0] || '#fff'} 50%, ${settings.backgroundGradient?.colors[1] || '#000'} 50%)`,
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundOrigin: 'border-box'
        };

    return (
        <div className="flex flex-col gap-6 relative">
            {/* Popover Portal */}
            {showColorPopover && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] shadow-2xl animate-in fade-in zoom-in-95 duration-100"
                    style={{
                        top: popoverPos.top,
                        left: popoverPos.left,
                        width: '300px'
                    }}
                >
                    <ColorSettings
                        isSolid={isSolid}
                        isGradient={isGradient}
                        color={backgroundColor}
                        gradient={settings.backgroundGradient}
                        onTypeChange={handleColorTypeChange}
                        onColorChange={handleColorChange}
                        onGradientColorChange={handleGradientColorChange}
                        onDirectionChange={handleDirectionChange}
                    />
                </div>,
                document.body
            )}

            {/* Main Background Grid */}
            <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Background</label>
                <div className="flex flex-wrap gap-4">
                    {/* 1. Color Card */}
                    <div
                        ref={colorButtonRef}
                        onClick={() => {
                            if (!isColorMode) {
                                updateSettings({
                                    backgroundType: lastMode
                                });
                            }
                            setShowColorPopover(!showColorPopover);
                        }}
                        className={`cursor-pointer w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all shadow-lg ${isColorMode || showColorPopover
                            ? 'border-blue-500 ring-2 ring-blue-500/30'
                            : 'border-transparent ring-1 ring-white/10 hover:ring-white/30'
                            }`}
                        style={colorCardStyle}
                        title="Color / Gradient"
                    >
                        {/* Icon only on hover */}
                        <div className="opacity-0 hover:opacity-100 transition-opacity bg-black/30 w-full h-full rounded-full flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                        </div>
                    </div>

                    {/* 2. Upload Card */}
                    <div
                        onClick={handleCustomSelect}
                        className={`cursor-pointer w-12 h-12 rounded-full border-2 flex items-center justify-center relative overflow-hidden transition-all shadow-lg ${isCustom
                            ? 'border-blue-500 ring-2 ring-blue-500/30'
                            : 'border-transparent bg-[#2a2a2a] ring-1 ring-white/10 hover:ring-white/30'
                            }`}
                        title="Upload Image"
                    >
                        {customSource ? (
                            <img src={customSource.url} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                            <svg className="text-gray-400" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                        )}
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept="image/*"
                            onChange={handleUpload}
                        />
                    </div>

                    {/* 3. Presets */}
                    {BACKGROUND_IMAGES.map(img => {
                        const isActive = isPreset && backgroundImageUrl === img.url;
                        return (
                            <div
                                key={img.url}
                                className={`cursor-pointer w-12 h-12 rounded-full border-2 overflow-hidden relative shadow-lg transition-all ${isActive
                                    ? 'border-blue-500 ring-2 ring-blue-500/30'
                                    : 'border-transparent ring-1 ring-white/10 hover:ring-white/30'}`}
                                onClick={() => handlePresetSelect(img.url)}
                                title={img.name}
                            >
                                <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Frame */}
            <div className="flex flex-col gap-3 pt-4 border-t border-gray-700">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Device Frame</label>
                <div className="grid grid-cols-2 gap-2">
                    {/* Frame Options */}
                    {DEVICE_FRAMES.map(frame => {
                        const isSelected = settings.deviceFrameId === frame.id;
                        return (
                            <div
                                key={frame.id}
                                onClick={() => updateWithBatching({ deviceFrameId: isSelected ? undefined : frame.id })}
                                className={`cursor-pointer w-full aspect-[16/10] rounded-lg border-2 flex flex-col items-center justify-center relative overflow-hidden transition-all bg-white ${isSelected
                                    ? 'border-blue-500 ring-2 ring-blue-500/30'
                                    : 'border-transparent ring-1 ring-black/5 hover:ring-black/10'
                                    }`}
                                title={frame.name}
                            >
                                <img
                                    src={frame.imageUrl}
                                    alt={frame.name}
                                    className="w-full h-full object-contain p-1"
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Effects */}
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
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(e) => updateWithBatching({ padding: parseFloat(e.target.value) })}
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
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(e) => updateWithBatching({ cornerRadius: parseInt(e.target.value) })}
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
                        onPointerDown={startInteraction}
                        onPointerUp={endInteraction}
                        onChange={(e) => updateWithBatching({ backgroundBlur: parseInt(e.target.value) })}
                        className="w-full accent-blue-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                </div>
            </div>
        </div>
    );
};
