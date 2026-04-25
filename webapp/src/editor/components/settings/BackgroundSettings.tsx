import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { ColorSettings } from './ColorSettings';
import { IoIosColorFilter } from "react-icons/io";
import { CiImageOn } from "react-icons/ci";
import { XButton, Slider, CollapsibleCard } from '@shared/components';
import { TbBackground } from 'react-icons/tb';
import type { PreviewItem } from '@shared/components';
import { LocalStorage, type CustomBackgroundEntry } from '../../../storage/localStorage';



const BACKGROUND_IMAGES = [
    { name: 'Dark Glass', url: '/assets/backgrounds/bg4.avif', thumbnail: '/assets/backgrounds/bg4-small.avif' },
    { name: 'Bubble Funky', url: '/assets/backgrounds/bg3.avif', thumbnail: '/assets/backgrounds/bg3-small.avif' },
    { name: 'Dark Pink Washed', url: '/assets/backgrounds/bg6.avif', thumbnail: '/assets/backgrounds/bg6-small.avif' },
    { name: 'Dark Pink Splatter', url: '/assets/backgrounds/bg5.avif', thumbnail: '/assets/backgrounds/bg5-small.avif' },
    { name: 'Blue Purple Layers', url: '/assets/backgrounds/bg1.avif', thumbnail: '/assets/backgrounds/bg1-small.avif' },
    { name: 'Layered Purples', url: '/assets/backgrounds/bg8.avif', thumbnail: '/assets/backgrounds/bg8-small.avif' },
    { name: 'Blue Purple Wash', url: '/assets/backgrounds/bg2.avif', thumbnail: '/assets/backgrounds/bg2-small.avif' },
    { name: 'Pink Blue Washed', url: '/assets/backgrounds/bg10.avif', thumbnail: '/assets/backgrounds/bg10-small.avif' },
    { name: 'Pink Purple Funky', url: '/assets/backgrounds/bg15.avif', thumbnail: '/assets/backgrounds/bg15-small.avif' },
    { name: 'Purple Pink Funky', url: '/assets/backgrounds/bg14.avif', thumbnail: '/assets/backgrounds/bg14-small.avif' },
    { name: 'Pink Purple Splash', url: '/assets/backgrounds/bg12.avif', thumbnail: '/assets/backgrounds/bg12-small.avif' },
    { name: 'Pink Clouds', url: '/assets/backgrounds/bg11.avif', thumbnail: '/assets/backgrounds/bg11-small.avif' },
    { name: 'Orange Teal Funky', url: '/assets/backgrounds/bg9.avif', thumbnail: '/assets/backgrounds/bg9-small.avif' },
    { name: 'Pink Teal Funky', url: '/assets/backgrounds/bg13.avif', thumbnail: '/assets/backgrounds/bg13-small.avif' },
    { name: 'Fluorescent Stripes', url: '/assets/backgrounds/bg7.avif', thumbnail: '/assets/backgrounds/bg7-small.avif' },
];

export const BackgroundSettings = () => {
    const project = useProjectData();
    const updateSettings = useProjectStore(s => s.updateSettings);
    const uploadAndSelectBackground = useProjectStore(s => s.uploadAndSelectBackground);
    const selectBackgroundFromLibrary = useProjectStore(s => s.selectBackgroundFromLibrary);
    const clearProjectBackground = useProjectStore(s => s.clearProjectBackground);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Collapsible visibility state
    const showCollapsibleBackground = useUIStore(s => s.showCollapsibleBackground);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    // Custom backgrounds library state
    const [customLibrary, setCustomLibrary] = useState<CustomBackgroundEntry[]>([]);
    const [libraryUrls, setLibraryUrls] = useState<Record<string, string>>({});

    // Load custom backgrounds library
    const loadLibrary = useCallback(async () => {
        const entries = await LocalStorage.listCustomBackgrounds();
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
    const { type: backgroundType, color: backgroundColor, imageUrl: backgroundImageUrl, customLibraryId, gradientColors, gradientDirection, backgroundBlurPx, colorMode } = background;

    // Helpers to determine active state
    // colorMode is always used to determine solid vs gradient when type is 'color'
    const isSolid = colorMode === 'solid';
    const isGradient = colorMode === 'gradient';
    const isColorMode = backgroundType === 'color';

    // Preset active if type is 'preset'
    const isPreset = backgroundType === 'preset';

    // Custom active if type is 'custom'
    const isCustom = backgroundType === 'custom';

    // The currently selected library entry ID (for matching in library display)
    const selectedLibraryId = isCustom ? customLibraryId : undefined;

    // --- Undo/Redo Batching Helpers ---
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    const handleColorTypeChange = (newColorMode: 'solid' | 'gradient') => {
        updateSettings({
            background: {
                type: 'color',
                colorMode: newColorMode
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

    const handleDirectionChange = (direction: number) => {
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

        await LocalStorage.deleteCustomBackground(libraryId);

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
        ? { background: `linear-gradient(${gradientDirection}deg, ${gradientColors[0]} 0%, ${gradientColors[1]} 100%)` }
        : { background: backgroundColor };

    // Generate preview circle style based on current background
    const getPreviewStyle = () => {
        if (backgroundType === 'color') {
            return colorMode === 'gradient'
                ? { background: `linear-gradient(${gradientDirection}deg, ${gradientColors[0]} 0%, ${gradientColors[1]} 100%)` }
                : { background: backgroundColor };
        } else if (backgroundType === 'preset') {
            const match = BACKGROUND_IMAGES.find(bg => bg.url === backgroundImageUrl);
            const previewUrl = match?.thumbnail ?? backgroundImageUrl;
            return { backgroundImage: `url(${previewUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' };
        } else if (backgroundType === 'custom' && background.customRuntimeUrl) {
            return { backgroundImage: `url(${background.customRuntimeUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' };
        }
        return { background: backgroundColor };
    };

    // Build preview items for collapsed state
    const previewItems: PreviewItem[] = [
        {
            type: 'custom',
            content: (
                <div
                    className="w-5 h-5 rounded-full border border-border"
                    style={getPreviewStyle()}
                />
            )
        }
    ];

    // Add blur amount for image backgrounds
    if ((backgroundType === 'preset' || backgroundType === 'custom') && backgroundBlurPx !== undefined) {
        previewItems.push({ type: 'text', content: `${Math.round(backgroundBlurPx)}px blur` });
    }

    return (
        <CollapsibleCard
            title="Background"
            icon={<TbBackground className="icon-md" />}
            notCollapsible
        >
            <div className="flex flex-col gap-4 text-sm select-none">
                <div className="flex flex-wrap gap-4 items-end justify-center w-full">
                    {/* 1. Color Card */}
                    <div className="flex flex-col items-center gap-2">
                        <span className="text-xs text-text-main">Color</span>
                        <div
                            ref={colorButtonRef}
                            onClick={() => {
                                // Set type to 'color' when clicking the color icon
                                if (backgroundType !== 'color') {
                                    updateSettings({ background: { type: 'color' } });
                                }
                                // Calculate position synchronously before showing popover to avoid flash
                                if (!showColorPopover && colorButtonRef.current) {
                                    const rect = colorButtonRef.current.getBoundingClientRect();
                                    const TOP_OFFSET = -20;
                                    const LEFT_OFFSET = 60; // 48px width + gap
                                    setPopoverPos({
                                        top: rect.top + TOP_OFFSET,
                                        left: rect.left + LEFT_OFFSET
                                    });
                                }
                                setShowColorPopover(v => !v);
                            }}
                            className={`cursor-pointer w-14 h-14 rounded-full flex items-center justify-center overflow-hidden transition-all hover:scale-110 ${isColorMode
                                ? 'outline outline-2 outline-offset-2 outline-primary'
                                : 'border border-transparent ring-1 ring-border hover:ring-border-hover'
                                }`}
                            style={colorCardStyle}
                            title="Color / Gradient"
                        >
                            <div className="p-1.5 rounded-full bg-black/20 text-white backdrop-blur-[1px]">
                                <IoIosColorFilter className="icon-lg" />
                            </div>
                        </div>

                    </div>

                    {/* 2. Upload Card */}
                    <div className="flex flex-col items-center gap-2">
                        <span className="text-xs text-text-main">Upload</span>
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="cursor-pointer w-14 h-14 rounded-full flex items-center justify-center relative overflow-hidden transition-all hover:scale-110 border border-transparent bg-surface-raised ring-1 ring-border hover:ring-border-hover not-hover:bg-state-inactive hover:bg-state-hover"
                            title="Upload Image"
                        >
                            <div className="flex items-center justify-center p-1.5 text-text-highlighted rounded-full bg-transparent">
                                <CiImageOn className="icon-lg" />
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
                                        {canDelete && (
                                            <XButton
                                                onClick={(e) => handleLibraryDelete(entry.id, e)}
                                                title="Remove from library"
                                                className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                            />
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
                                    <img src={img.thumbnail} alt={img.name} className="w-full h-full object-cover" />
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Effects */}
                <div className="flex flex-col gap-4">
                    {/* Blur */}
                    {(backgroundType === 'preset' || backgroundType === 'custom') && (
                        <Slider
                            label="Blur"
                            min={0}
                            max={100}
                            value={backgroundBlurPx || 0}
                            onPointerDown={startInteraction}
                            onPointerUp={endInteraction}
                            onChange={(val) => batchAction(() => updateSettings({
                                background: {
                                    backgroundBlurPx: val
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
                        className="fixed z-[9999] bg-surface-raised border border-border rounded-lg shadow-lg"
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
            </div>
        </CollapsibleCard>
    );
};
