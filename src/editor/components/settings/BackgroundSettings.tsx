import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore, useProjectData, useProjectSources } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { ColorSettings } from './ColorSettings';
import { IoIosColorFilter } from "react-icons/io";
import { CiImageOn } from "react-icons/ci";
import { Slider } from '../common/Slider';
// import { ScreenSettings } from './ScreenSettings';

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
    const { background } = settings;
    const { type: backgroundType, color: backgroundColor, imageUrl: backgroundImageUrl, sourceId: backgroundSourceId, customSourceId: customBackgroundSourceId, gradientColors, gradientDirection, backgroundBlur } = background;

    // Helpers to determine active state
    const isSolid = backgroundType === 'solid';
    const isGradient = backgroundType === 'gradient';
    const isColorMode = isSolid || isGradient;

    // Preset active if image mode AND no source ID (implies generic url) AND url matches
    const isPreset = backgroundType === 'image' && !backgroundSourceId && !!backgroundImageUrl;

    // Custom active if image mode AND source ID present
    const isCustom = backgroundType === 'image' && !!backgroundSourceId;

    // --- Undo/Redo Batching Helpers ---
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const handleColorTypeChange = (type: 'solid' | 'gradient') => {
        updateSettings({
            background: {
                type,
                lastColorMode: type
            }
        });
    };

    const handleColorChange = (color: string) => {
        batchAction(() => updateSettings({
            background: {
                color
            }
        }));
    };

    const handleGradientColorChange = (index: 0 | 1, color: string) => {
        const newColors = [...gradientColors] as [string, string];
        newColors[index] = color;

        batchAction(() => updateSettings({
            background: {
                gradientColors: newColors
            }
        }));
    };

    const handleDirectionChange = (direction: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW') => {
        updateSettings({
            background: {
                gradientDirection: direction
            }
        });
    };

    const handlePresetSelect = (url: string) => {
        updateSettings({
            background: {
                type: 'image',
                imageUrl: url,
                sourceId: undefined
            }
        });
    };

    const handleCustomSelect = () => {
        if (customBackgroundSourceId && !isCustom) {
            updateSettings({
                background: {
                    type: 'image',
                    sourceId: customBackgroundSourceId
                }
            });
        } else {
            fileInputRef.current?.click();
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const newSourceId = await addSource(file, 'image', { name: file.name });
            updateSettings({
                background: {
                    type: 'image',
                    sourceId: newSourceId,
                    customSourceId: newSourceId
                }
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
                endInteraction();
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
    const showSolidPreview = isSolid || (!isColorMode && background.lastColorMode === 'solid');

    const colorCardStyle: React.CSSProperties = showSolidPreview
        ? { backgroundColor: backgroundColor }
        : {
            backgroundImage: `linear-gradient(${getGradientAngle(gradientDirection)}deg, ${gradientColors[0]} 50%, ${gradientColors[1]} 50%)`,
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
                        gradient={{ colors: gradientColors, direction: gradientDirection }}
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
                                        background: {
                                            type: background.lastColorMode
                                        }
                                    });
                                }
                                if (!showColorPopover) {
                                    startInteraction();
                                } else {
                                    endInteraction();
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

            {/* Effects */}
            <div className="flex flex-col gap-4 pt-4 border-t border-gray-700">
                {/* Blur */}
                {backgroundType === 'image' && (
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Blur</label>
                        <Slider
                            min={0}
                            max={50}
                            value={backgroundBlur || 0}
                            onPointerDown={startInteraction}
                            onPointerUp={endInteraction}
                            onChange={(val) => batchAction(() => updateSettings({
                                background: {
                                    backgroundBlur: val
                                }
                            }))}
                        />
                    </div>
                )}
            </div>
        </div >
    );
};
