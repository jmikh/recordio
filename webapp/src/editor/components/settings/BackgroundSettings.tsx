import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useMediaUrlStore } from '../../stores/useMediaUrlStore';
import { useAssetLibraryStore } from '../../stores/useAssetLibraryStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { UserAssetService } from '../../../storage/userAssetService';
import { ColorSettings } from './ColorSettings';
import { IoIosColorFilter } from "react-icons/io";
import { CiImageOn } from "react-icons/ci";
import { XButton, Slider, CollapsibleCard } from '@shared/components';
import { TbBackground } from 'react-icons/tb';
import { useToast } from '../Toast';
import type { PreviewItem } from '@shared/components';
import { CDN_ORIGIN } from '@shared/types/bridge';
import { trackUploadBackgroundClicked } from '../../../core/analytics';



const CDN = `${CDN_ORIGIN}/backgrounds`;

const BACKGROUND_IMAGES = [
    { name: 'Dark Glass', url: `${CDN}/bg4.avif`, thumbnail: `${CDN}/bg4-small.avif` },
    { name: 'Bubble Funky', url: `${CDN}/bg3.avif`, thumbnail: `${CDN}/bg3-small.avif` },
    { name: 'Dark Pink Washed', url: `${CDN}/bg6.avif`, thumbnail: `${CDN}/bg6-small.avif` },
    { name: 'Dark Pink Splatter', url: `${CDN}/bg5.avif`, thumbnail: `${CDN}/bg5-small.avif` },
    { name: 'Blue Purple Layers', url: `${CDN}/bg1.avif`, thumbnail: `${CDN}/bg1-small.avif` },
    { name: 'Layered Purples', url: `${CDN}/bg8.avif`, thumbnail: `${CDN}/bg8-small.avif` },
    { name: 'Blue Purple Wash', url: `${CDN}/bg2.avif`, thumbnail: `${CDN}/bg2-small.avif` },
    { name: 'Pink Blue Washed', url: `${CDN}/bg10.avif`, thumbnail: `${CDN}/bg10-small.avif` },
    { name: 'Pink Purple Funky', url: `${CDN}/bg15.avif`, thumbnail: `${CDN}/bg15-small.avif` },
    { name: 'Purple Pink Funky', url: `${CDN}/bg14.avif`, thumbnail: `${CDN}/bg14-small.avif` },
    { name: 'Pink Purple Splash', url: `${CDN}/bg12.avif`, thumbnail: `${CDN}/bg12-small.avif` },
    { name: 'Pink Clouds', url: `${CDN}/bg11.avif`, thumbnail: `${CDN}/bg11-small.avif` },
    { name: 'Orange Teal Funky', url: `${CDN}/bg9.avif`, thumbnail: `${CDN}/bg9-small.avif` },
    { name: 'Pink Teal Funky', url: `${CDN}/bg13.avif`, thumbnail: `${CDN}/bg13-small.avif` },
    { name: 'Fluorescent Stripes', url: `${CDN}/bg7.avif`, thumbnail: `${CDN}/bg7-small.avif` },
];

export const BackgroundSettings = () => {
    const project = useProjectData();
    const updateSettings = useProjectStore(s => s.updateSettings);
    const selectBackground = useProjectStore(s => s.selectBackground);
    const clearBackground = useProjectStore(s => s.clearBackground);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Collapsible visibility state
    const showCollapsibleBackground = useUIStore(s => s.showCollapsibleBackground);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    // Asset library (loaded once on project open, updated on upload/delete)
    const customLibrary = useAssetLibraryStore(s => s.backgrounds);
    const libraryUrls = useAssetLibraryStore(s => s.blobUrls);
    const canUploadBg = useAssetLibraryStore(s => s.canUploadBackground);
    const addAsset = useAssetLibraryStore(s => s.addAsset);
    const removeAsset = useAssetLibraryStore(s => s.removeAsset);
    const [isUploading, setIsUploading] = useState(false);
    const canUpload = canUploadBg();
    const { addToast } = useToast();

    // Defensive check
    if (!project) return null;

    const { settings } = project;
    const { background } = settings;
    const { type: backgroundType, color: backgroundColor, imageUrl: backgroundImageUrl, storagePath: bgStoragePath, gradientColors, gradientDirection, backgroundBlurPx, colorMode } = background;

    // Read blob URL for current custom background from media URL store
    const customBgBlobUrl = useMediaUrlStore(s => bgStoragePath ? s.urls[bgStoragePath] : undefined);

    // Helpers to determine active state
    const isSolid = colorMode === 'solid';
    const isGradient = colorMode === 'gradient';
    const isColorMode = backgroundType === 'color';
    const isPreset = backgroundType === 'preset';
    const isCustom = backgroundType === 'custom';

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

    const handlePresetSelect = (url: string) => {
        updateSettings({
            background: {
                type: 'preset',
                imageUrl: url,
                storagePath: undefined,
            }
        });
    };

    const handleLibrarySelect = async (storagePath: string) => {
        if (bgStoragePath === storagePath) return;
        try {
            await selectBackground(storagePath);
        } catch (err) {
            console.error('Failed to select background from library', err);
        }
    };

    const handleLibraryDelete = async (assetId: string, storagePath: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            if (bgStoragePath === storagePath) {
                clearBackground();
            }
            await removeAsset(assetId, storagePath);
        } catch (err) {
            console.error('Failed to delete background asset', err);
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        trackUploadBackgroundClicked(project.id);
        setIsUploading(true);
        try {
            const asset = await UserAssetService.uploadAsset(file, 'background');
            addAsset(asset);
            await selectBackground(asset.storagePath);
            addToast({ type: 'success', title: 'Background saved in your library' });
        } catch (err) {
            console.error('Failed to upload background', err);
            addToast({ type: 'error', title: 'Failed to upload background' });
        } finally {
            setIsUploading(false);
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
        } else if (backgroundType === 'custom' && customBgBlobUrl) {
            return { backgroundImage: `url(${customBgBlobUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' };
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
                            onClick={() => canUpload && !isUploading && fileInputRef.current?.click()}
                            className={`w-14 h-14 rounded-full flex items-center justify-center relative overflow-hidden transition-all border border-transparent bg-surface-raised ring-1 ring-border ${
                                !canUpload || isUploading
                                    ? 'opacity-50 cursor-not-allowed'
                                    : 'cursor-pointer hover:scale-110 hover:ring-border-hover not-hover:bg-state-inactive hover:bg-state-hover'
                            }`}
                            title={!canUpload ? 'Library full (10/10) — delete an image to upload a new one' : isUploading ? 'Uploading...' : 'Upload Image'}
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
                        <span className="text-xs text-text-main">Your Library</span>
                        <div className="flex flex-wrap justify-center gap-4">
                            {customLibrary.map(entry => {
                                const url = libraryUrls[entry.storagePath];
                                const isActive = bgStoragePath === entry.storagePath;
                                return (
                                    <div
                                        key={entry.id}
                                        className="relative group"
                                    >
                                        <div
                                            className={`cursor-pointer w-14 h-14 rounded-full overflow-hidden relative transition-all hover:scale-110 ${isActive
                                                ? 'outline outline-2 outline-offset-2 outline-primary'
                                                : 'border border-transparent ring-1 ring-border hover:ring-border-hover'}`}
                                            onClick={() => handleLibrarySelect(entry.storagePath)}
                                            title={entry.name ?? 'Custom background'}
                                        >
                                            {url && <img src={url} alt={entry.name ?? 'Custom background'} className="w-full h-full object-cover" />}
                                        </div>
                                        <XButton
                                            onClick={(e) => handleLibraryDelete(entry.id, entry.storagePath, e)}
                                            title="Remove from library"
                                            className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                        />
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
