import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore, useProjectData, useProjectSources } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { DEVICE_FRAMES } from '../../../core/deviceFrames';
import { ColorSettings } from './ColorSettings';
import { IoIosColorFilter } from "react-icons/io";
import { CiImageOn } from "react-icons/ci";

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
        // If we have a custom source AND we are not currently using it, just switch to it.
        // Otherwise (if we are using it OR we don't have one), open the picker to upload/replace.
        if (customBackgroundSourceId && !isCustom) {
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
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 block">Background</label>
                <div className="flex flex-col gap-4">
                    {/* Row 1: Color + Upload */}
                    <div className="flex gap-4">
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
                            {/* Icon always visible */}
                            <div className="p-1.5 rounded-full bg-black/20 text-white backdrop-blur-[1px]">
                                <IoIosColorFilter size={20} />
                            </div>
                        </div>

                        {/* 2. Upload Card */}
                        <div
                            onClick={handleCustomSelect}
                            className={`cursor-pointer w-12 h-12 rounded-full border-2 flex items-center justify-center relative overflow-hidden transition-all shadow-lg ${isCustom
                                ? 'border-blue-500 ring-2 ring-blue-500/30'
                                : 'border-transparent bg-gray-700 ring-1 ring-white/10 hover:ring-white/30'
                                }`}
                            title="Upload Image"
                        >
                            {customSource && (
                                <img src={customSource.url} className="absolute inset-0 w-full h-full object-cover" />
                            )}
                            {/* Always show icon, but style it as overlay if image exists */}
                            <div className={`flex items-center justify-center p-1.5 rounded-full ${customSource ? 'bg-black/40 text-white z-10' : 'bg-black/20 text-white'}`}>
                                <CiImageOn size={20} />
                            </div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleUpload}
                            />
                        </div>
                    </div>

                    {/* Row 2: Presets */}
                    <div className="flex flex-wrap gap-4">
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
            </div>

            {/* Frame */}
            <div className="flex flex-col gap-3 pt-4 border-t border-gray-700">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Device Frame</label>
                <div className="grid grid-cols-2 gap-2">
                    {/* Frame Options */}
                    {DEVICE_FRAMES.map(frame => {
                        const isSelected = settings.deviceFrameId === frame.id;
                        return (
                            <div key={frame.id} className="flex flex-col gap-1">
                                <div
                                    onClick={() => updateWithBatching({ deviceFrameId: isSelected ? undefined : frame.id })}
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
                        max={250}
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
                        max={50}
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
