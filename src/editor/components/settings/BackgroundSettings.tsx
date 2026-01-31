import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { ColorSettings } from './ColorSettings';
import { IoIosColorFilter, IoIosClose } from "react-icons/io";
import { CiImageOn } from "react-icons/ci";
import { Slider } from '../../../components/ui/Slider';
import { ProjectStorage, type CustomBackgroundEntry } from '../../../storage/projectStorage';

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
    { name: 'Background 1', url: '/assets/backgrounds/bg1.avif' },
    { name: 'Background 2', url: '/assets/backgrounds/bg2.avif' },
    { name: 'Background 3', url: '/assets/backgrounds/bg3.avif' },
    { name: 'Background 4', url: '/assets/backgrounds/bg4.avif' },
    { name: 'Background 5', url: '/assets/backgrounds/bg5.avif' },
    { name: 'Background 6', url: '/assets/backgrounds/bg6.avif' },
    { name: 'Background 7', url: '/assets/backgrounds/bg7.avif' },
    { name: 'Background 8', url: '/assets/backgrounds/bg8.avif' },
    { name: 'Background 9', url: '/assets/backgrounds/bg9.avif' },
    { name: 'Background 10', url: '/assets/backgrounds/bg10.avif' },
    { name: 'Background 11', url: '/assets/backgrounds/bg11.avif' },
    { name: 'Background 12', url: '/assets/backgrounds/bg12.avif' },
    { name: 'Background 13', url: '/assets/backgrounds/bg13.avif' },
    { name: 'Background 14', url: '/assets/backgrounds/bg14.avif' },
    { name: 'Background 15', url: '/assets/backgrounds/bg15.avif' },
];

export const BackgroundSettings = () => {
    const project = useProjectData();
    const updateSettings = useProjectStore(s => s.updateSettings);
    const uploadAndSelectBackground = useProjectStore(s => s.uploadAndSelectBackground);
    const selectBackgroundFromLibrary = useProjectStore(s => s.selectBackgroundFromLibrary);
    const clearProjectBackground = useProjectStore(s => s.clearProjectBackground);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Custom backgrounds library state
    const [customLibrary, setCustomLibrary] = useState<CustomBackgroundEntry[]>([]);
    const [libraryUrls, setLibraryUrls] = useState<Record<string, string>>({});

    // Load custom backgrounds library
    const loadLibrary = useCallback(async () => {
        const entries = await ProjectStorage.listCustomBackgrounds();
        setCustomLibrary(entries);

        // Create blob URLs for thumbnails
        const urls: Record<string, string> = {};
        for (const entry of entries) {
            urls[entry.id] = URL.createObjectURL(entry.blob);
        }
        // Revoke old URLs
        Object.values(libraryUrls).forEach(url => URL.revokeObjectURL(url));
        setLibraryUrls(urls);
    }, []);

    useEffect(() => {
        loadLibrary();
        return () => {
            // Cleanup URLs on unmount
            Object.values(libraryUrls).forEach(url => URL.revokeObjectURL(url));
        };
    }, []);

    // Defensive check
    if (!project) return null;

    const { settings } = project;
    const { background } = settings;
    const { type: backgroundType, color: backgroundColor, imageUrl: backgroundImageUrl, customLibraryId, gradientColors, gradientDirection, backgroundBlur, lastColorMode } = background;

    // Helpers to determine active state
    // Use lastColorMode as fallback when backgroundType is not a color mode (preset/custom)
    const effectiveColorMode = (backgroundType === 'solid' || backgroundType === 'gradient')
        ? backgroundType
        : lastColorMode;
    const isSolid = effectiveColorMode === 'solid';
    const isGradient = effectiveColorMode === 'gradient';
    const isColorMode = backgroundType === 'solid' || backgroundType === 'gradient';

    // Preset active if type is 'preset'
    const isPreset = backgroundType === 'preset';

    // Custom active if type is 'custom'
    const isCustom = backgroundType === 'custom';

    // The currently selected library entry ID (for matching in library display)
    const selectedLibraryId = isCustom ? customLibraryId : undefined;

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

    const handlePresetSelect = async (url: string) => {
        // Clear old custom background copy if switching from custom
        if (isCustom) {
            await clearProjectBackground();
        }
        updateSettings({
            background: {
                type: 'preset',
                imageUrl: url,
                customStorageUrl: undefined,
                customRuntimeUrl: undefined,
                customLibraryId: undefined
            }
        });
    };

    const handleLibrarySelect = async (libraryId: string) => {
        // Don't re-select if already selected
        if (selectedLibraryId === libraryId) return;

        try {
            // Clear old custom background copy
            await clearProjectBackground();

            // Copy from library to project
            const { storageUrl, runtimeUrl } = await selectBackgroundFromLibrary(libraryId);
            updateSettings({
                background: {
                    type: 'custom',
                    imageUrl: undefined,
                    customStorageUrl: storageUrl,
                    customRuntimeUrl: runtimeUrl,
                    customLibraryId: libraryId
                }
            });
        } catch (err) {
            console.error("Failed to select background from library", err);
        }
    };

    const handleLibraryDelete = async (libraryId: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Don't trigger select

        await ProjectStorage.deleteCustomBackground(libraryId);

        // Revoke URL
        if (libraryUrls[libraryId]) {
            URL.revokeObjectURL(libraryUrls[libraryId]);
        }

        // Reload library
        await loadLibrary();
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            // Clear old custom background copy
            await clearProjectBackground();

            // Upload to library AND select for project
            const { libraryId, storageUrl, runtimeUrl } = await uploadAndSelectBackground(file);
            updateSettings({
                background: {
                    type: 'custom',
                    imageUrl: undefined,
                    customStorageUrl: storageUrl,
                    customRuntimeUrl: runtimeUrl,
                    customLibraryId: libraryId
                }
            });

            // Reload library to show new entry
            await loadLibrary();
        } catch (err) {
            console.error("Failed to upload background", err);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

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
                top: rect.top + TOP_OFFSET,
                left: rect.left + LEFT_OFFSET
            });
        }
    }, [showColorPopover]);

    useEffect(() => {
        if (!showColorPopover) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node) && !colorButtonRef.current?.contains(e.target as Node)) {
                setShowColorPopover(false);
            }
        };

        const handleScroll = () => {
            setShowColorPopover(false);
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('scroll', handleScroll, true);
        };
    }, [showColorPopover]);

    // Compute dynamic style for color card
    const colorCardStyle = isGradient
        ? { background: `linear-gradient(${getGradientAngle(gradientDirection)}deg, ${gradientColors[0]} 0%, ${gradientColors[1]} 100%)` }
        : { background: backgroundColor };

    return (
        <div className="flex flex-col gap-4 xrounded-lg  shadow-sm text-sm select-none">
            {/* Background Picker */}
            <div className="flex flex-col gap-4">
                <div className="flex flex-col items-start gap-4">
                    {/* Row 1: Color Card + Upload */}
                    <div className="flex flex-wrap gap-4 items-end justify-center w-full">
                        {/* 1. Color Card */}
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-xs text-text-main">Color</span>
                            <div
                                ref={colorButtonRef}
                                onClick={() => setShowColorPopover(v => !v)}
                                className={`cursor-pointer w-14 h-14 rounded-full flex items-center justify-center overflow-hidden transition-all hover:scale-110 ${isColorMode
                                    ? 'outline outline-2 outline-offset-2 outline-primary'
                                    : 'border border-transparent ring-1 ring-border hover:ring-border-hover'
                                    }`}
                                style={colorCardStyle}
                                title="Color / Gradient"
                            >
                                <div className="p-1.5 rounded-full bg-black/20 text-white backdrop-blur-[1px]">
                                    <IoIosColorFilter size={20} />
                                </div>
                            </div>

                        </div>

                        {/* 2. Upload Card */}
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-xs text-text-main">Upload</span>
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="cursor-pointer w-14 h-14 rounded-full flex items-center justify-center relative overflow-hidden transition-all hover:scale-110 border border-transparent bg-surface-raised ring-1 ring-border hover:ring-border-hover not-hover:bg-hover-subtle hover:bg-hover"
                                title="Upload Image"
                            >
                                <div className="flex items-center justify-center p-1.5 text-text-highlighted rounded-full bg-transparent">
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
                    </div>

                    {/* Row 2: Custom Library (if any) */}
                    {customLibrary.length > 0 && (
                        <div className="flex flex-col items-center gap-2 w-full">
                            <span className="text-xs text-text-main">Custom</span>
                            <div className="flex flex-wrap justify-center gap-4">
                                {customLibrary.map(entry => {
                                    const url = libraryUrls[entry.id];
                                    // Check if this library entry is the one currently selected
                                    const isActive = selectedLibraryId === entry.id;
                                    // Can't delete the selected entry
                                    const canDelete = !isActive;
                                    return (
                                        <div
                                            key={entry.id}
                                            className="relative group"
                                        >
                                            <div
                                                className={`cursor-pointer w-14 h-14 rounded-full overflow-hidden relative transition-all hover:scale-110 ${isActive
                                                    ? 'outline outline-2 outline-offset-2 outline-primary'
                                                    : 'border border-transparent ring-1 ring-border hover:ring-border-hover'}`}
                                                onClick={() => handleLibrarySelect(entry.id)}
                                                title="Select background"
                                            >
                                                {url && <img src={url} alt="Custom background" className="w-full h-full object-cover" />}
                                            </div>
                                            {/* Delete button - hidden when selected */}
                                            {canDelete && (
                                                <button
                                                    onClick={(e) => handleLibraryDelete(entry.id, e)}
                                                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                                                    title="Remove from library"
                                                >
                                                    <IoIosClose size={16} />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Row 3: Presets */}
                    <div className="flex flex-col items-center gap-2 w-full">
                        <span className="text-xs text-text-main">Presets</span>
                        <div className="flex flex-wrap justify-center gap-4">
                            {BACKGROUND_IMAGES.map(img => {
                                const isActive = isPreset && backgroundImageUrl === img.url;
                                return (
                                    <div
                                        key={img.url}
                                        className={`cursor-pointer w-14 h-14 rounded-full overflow-hidden relative transition-all hover:scale-110 ${isActive
                                            ? 'outline outline-2 outline-offset-2 outline-primary'
                                            : 'border border-transparent ring-1 ring-border hover:ring-border-hover'}`}
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
            </div>

            {/* Effects */}
            <div className="flex flex-col gap-4 pt-4 border-t border-border">
                {/* Blur */}
                {(backgroundType === 'preset' || backgroundType === 'custom') && (
                    <Slider
                        label="Blur"
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
                        showTooltip
                        units="px"
                    />
                )}
            </div>

            {/* Color Popover (Portal) */}
            {showColorPopover && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] bg-surface-overlay border border-border rounded-lg shadow-lg"
                    style={{ top: popoverPos.top, left: popoverPos.left }}
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
        </div >
    );
};
