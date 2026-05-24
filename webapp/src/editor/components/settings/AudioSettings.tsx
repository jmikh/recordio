import { useRef, useState, useEffect } from 'react';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useAssetLibraryStore } from '../../stores/useAssetLibraryStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { UserAssetService } from '../../../storage/userAssetService';
import { Toggle, Slider, CollapsibleCard, XButton } from '@shared/components';
import type { PreviewItem } from '@shared/components';
import { CDN_ORIGIN } from '@shared/types/bridge';
import { TbMusic, TbUpload, TbPlayerPlay, TbPlayerPause, TbVolume } from 'react-icons/tb';
import { trackUploadMusicClicked } from '../../../core/analytics';

// CDN preset music tracks
const PRESET_MUSIC = [
    { name: 'Ambient', url: `${CDN_ORIGIN}/music/ambient.mp3` },
    { name: 'Bassy', url: `${CDN_ORIGIN}/music/bassy.mp3` },
    { name: 'Energetic', url: `${CDN_ORIGIN}/music/energetic.mp3` },
    { name: 'Lo-Fi 1', url: `${CDN_ORIGIN}/music/lofi 1.mp3` },
    { name: 'Lo-Fi 2', url: `${CDN_ORIGIN}/music/lofi 2.mp3` },
];

export const AudioSettingsPanel = () => {
    const project = useProjectData();
    const updateSettings = useProjectStore(s => s.updateSettings);
    const selectMusic = useProjectStore(s => s.selectMusic);
    const clearMusic = useProjectStore(s => s.clearMusic);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Collapsible state
    const showCollapsibleAudioToggles = useUIStore(s => s.showCollapsibleAudioToggles);
    const showCollapsibleMusic = useUIStore(s => s.showCollapsibleMusic);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    // Asset library (loaded once on project open)
    const customLibrary = useAssetLibraryStore(s => s.music);
    const blobUrls = useAssetLibraryStore(s => s.blobUrls);
    const canUploadMusic = useAssetLibraryStore(s => s.canUploadMusic);
    const addAsset = useAssetLibraryStore(s => s.addAsset);
    const removeAsset = useAssetLibraryStore(s => s.removeAsset);
    const [isUploading, setIsUploading] = useState(false);

    // Audio preview state
    const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
    const [previewingUrl, setPreviewingUrl] = useState<string | null>(null);
    const [previewingEntryId, setPreviewingEntryId] = useState<string | null>(null);

    // Undo/redo batching
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Cleanup preview audio on unmount
    useEffect(() => {
        return () => {
            if (previewAudio) {
                previewAudio.pause();
                previewAudio.src = '';
            }
        };
    }, [previewAudio]);

    // Sync preview volume when music volume setting changes
    const musicVolume = project?.settings?.audio?.music?.volume ?? 0.3;
    useEffect(() => {
        if (previewAudio) {
            previewAudio.volume = musicVolume;
        }
    }, [previewAudio, musicVolume]);

    // Stop preview when timeline playback starts
    const isPlaying = useUIStore(s => s.isPlaying);
    useEffect(() => {
        if (isPlaying && previewAudio) {
            previewAudio.pause();
            if (previewingUrl) URL.revokeObjectURL(previewingUrl);
            setPreviewAudio(null);
            setPreviewingUrl(null);
            setPreviewingEntryId(null);
        }
    }, [isPlaying]);

    if (!project) return null;

    const { settings } = project;
    const audio = settings.audio;
    const music = audio?.music;

    // Determine audio capabilities
    const screenSource = project.screenSource;
    const screenHasAudio = screenSource?.hasAudio ?? false;
    const hasMic = !!project.microphoneSource;



    // Preview helper
    const togglePreview = (url: string) => {
        if (previewingUrl === url && previewAudio) {
            previewAudio.pause();
            setPreviewAudio(null);
            setPreviewingUrl(null);
            setPreviewingEntryId(null);
            return;
        }

        // Stop current preview
        if (previewAudio) {
            previewAudio.pause();
        }

        // Pause timeline playback while previewing
        useUIStore.getState().setIsPlaying(false);

        const audio = new Audio(url);
        audio.volume = music?.volume ?? 0.3;
        audio.play().catch(console.error);
        audio.onended = () => {
            setPreviewAudio(null);
            setPreviewingUrl(null);
            setPreviewingEntryId(null);
        };
        setPreviewAudio(audio);
        setPreviewingUrl(url);
    };

    // Handlers
    const handlePresetSelect = (preset: typeof PRESET_MUSIC[0]) => {
        updateSettings({
            audio: {
                music: {
                    enabled: true,
                    source: 'preset',
                    presetUrl: preset.url,
                    presetName: preset.name,
                    storagePath: undefined,
                },
            },
        });
    };

    const handleCustomSelect = async (storagePath: string) => {
        try {
            await selectMusic(storagePath);
        } catch (err) {
            console.error('Failed to select custom music', err);
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        trackUploadMusicClicked(project.id);
        setIsUploading(true);
        try {
            const asset = await UserAssetService.uploadAsset(file, 'music');
            addAsset(asset);
            await selectMusic(asset.storagePath);
        } catch (err) {
            console.error('Failed to upload music', err);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleLibraryDelete = async (id: string, storagePath: string, e: React.MouseEvent) => {
        e.stopPropagation();

        // Stop preview if this entry is being previewed
        if (previewingEntryId === id && previewAudio) {
            previewAudio.pause();
            if (previewingUrl) URL.revokeObjectURL(previewingUrl);
            setPreviewAudio(null);
            setPreviewingUrl(null);
            setPreviewingEntryId(null);
        }

        // If deleted asset is currently selected, clear it
        if (music?.storagePath === storagePath) {
            clearMusic();
        }

        await removeAsset(id, storagePath);
    };

    // Build preview items for audio toggles card
    const audioTogglePreviewItems: PreviewItem[] = [];
    if (screenHasAudio && audio?.muteScreenAudio) {
        audioTogglePreviewItems.push({ type: 'text', content: 'Screen muted' });
    }
    if (hasMic && audio?.muteMicrophone) {
        audioTogglePreviewItems.push({ type: 'text', content: 'Mic muted' });
    }
    if (!screenHasAudio && !hasMic) {
        audioTogglePreviewItems.push({ type: 'text', content: 'Not detected' });
    } else if (audioTogglePreviewItems.length === 0) {
        audioTogglePreviewItems.push({ type: 'text', content: 'On' });
    }

    // Build preview items for music card
    const musicPreviewItems: PreviewItem[] = [];
    if (music?.enabled) {
        const name = music.source === 'preset' ? music.presetName : 'Custom';
        musicPreviewItems.push({ type: 'text', content: name || 'On' });
        musicPreviewItems.push({ type: 'text', content: `${Math.round((music.volume ?? 0.3) * 100)}%` });
    } else {
        musicPreviewItems.push({ type: 'text', content: 'Off' });
    }

    // Determine which preset/custom is selected
    const selectedPresetUrl = music?.source === 'preset' ? music.presetUrl : undefined;
    const selectedCustomPath = music?.source === 'custom' ? music.storagePath : undefined;

    return (
        <div className="flex flex-col gap-2">
            {/* Audio Source Toggles */}
            <CollapsibleCard
                title="Audio"
                icon={<TbVolume className="icon-md" />}
                previewItems={audioTogglePreviewItems}
                isExpanded={showCollapsibleAudioToggles}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleAudioToggles', v)}
            >
                <div className="flex flex-col gap-3">

                    {/* Screen Audio */}
                    {screenHasAudio ? (
                        <>
                            <Toggle
                                label="Screen Audio"
                                value={!audio?.muteScreenAudio}
                                onChange={(v) => updateSettings({ audio: { muteScreenAudio: !v } })}
                            />
                            {!audio?.muteScreenAudio && (
                                <Slider
                                    label="Volume"
                                    min={0}
                                    max={100}
                                    value={Math.round((audio?.screenVolume ?? 1) * 100)}
                                    onPointerDown={startInteraction}
                                    onPointerUp={endInteraction}
                                    onChange={(val) =>
                                        batchAction(() =>
                                            updateSettings({ audio: { screenVolume: val / 100 } })
                                        )
                                    }
                                    showTooltip
                                    units="%"
                                />
                            )}
                        </>
                    ) : (
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-text-muted">Screen Audio</span>
                            <span className="text-xs text-text-disabled">Not Detected</span>
                        </div>
                    )}

                    {/* Microphone */}
                    {hasMic ? (
                        <>
                            <Toggle
                                label="Microphone"
                                value={!audio?.muteMicrophone}
                                onChange={(v) => updateSettings({ audio: { muteMicrophone: !v } })}
                            />
                            {!audio?.muteMicrophone && (
                                <Slider
                                    label="Volume"
                                    min={0}
                                    max={100}
                                    value={Math.round((audio?.microphoneVolume ?? 1) * 100)}
                                    onPointerDown={startInteraction}
                                    onPointerUp={endInteraction}
                                    onChange={(val) =>
                                        batchAction(() =>
                                            updateSettings({ audio: { microphoneVolume: val / 100 } })
                                        )
                                    }
                                    showTooltip
                                    units="%"
                                />
                            )}
                        </>
                    ) : (
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-text-muted">Microphone</span>
                            <span className="text-xs text-text-disabled">Not Detected</span>
                        </div>
                    )}
                </div>
            </CollapsibleCard>

            {/* Background Music */}
            <CollapsibleCard
                title="Music"
                icon={<TbMusic className="icon-md" />}
                previewItems={musicPreviewItems}
                isExpanded={showCollapsibleMusic}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleMusic', v)}
            >
                <div className="flex flex-col gap-4 text-sm select-none">
                    {/* Enable toggle */}
                    <Toggle
                        label="Enabled"
                        value={music?.enabled ?? false}
                        onChange={(v) => {
                            if (v && !music?.presetUrl && !music?.storagePath) {
                                // First time enabling: auto-select the first preset
                                const first = PRESET_MUSIC[0];
                                updateSettings({
                                    audio: {
                                        music: {
                                            enabled: true,
                                            source: 'preset',
                                            presetUrl: first.url,
                                            presetName: first.name,
                                        },
                                    },
                                });
                            } else {
                                updateSettings({ audio: { music: { enabled: v } } });
                            }
                        }}
                    />

                    {music?.enabled && (
                        <>
                            {/* Volume */}
                            <Slider
                                label="Volume"
                                min={0}
                                max={100}
                                value={Math.round((music.volume ?? 0.3) * 100)}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(val) =>
                                    batchAction(() =>
                                        updateSettings({ audio: { music: { volume: val / 100 } } })
                                    )
                                }
                                showTooltip
                                units="%"
                            />

                            {/* Fade Out */}
                            <Slider
                                label="Fade Out"
                                min={0}
                                max={50}
                                value={Math.round((music.fadeOutDurationMs ?? 3000) / 100)}
                                onPointerDown={startInteraction}
                                onPointerUp={endInteraction}
                                onChange={(val) => {
                                    // Round to nearest 500ms (5 tenths)
                                    const rounded = Math.round(val / 5) * 5;
                                    const ms = rounded * 100;
                                    batchAction(() =>
                                        updateSettings({ audio: { music: { fadeOutDurationMs: ms } } })
                                    );
                                }}
                                showTooltip
                                decimals={1}
                                valueTransform={(v) => v / 10}
                                units="s"
                            />

                            {/* Presets */}
                            <div className="flex flex-col gap-2">
                                <span className="text-xs text-text-muted">Presets</span>
                                <div className="flex flex-col gap-1">
                                    {PRESET_MUSIC.map((preset) => {
                                        const isActive = selectedPresetUrl === preset.url;
                                        return (
                                            <div
                                                key={preset.url}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isActive
                                                    ? 'bg-primary/15 text-primary'
                                                    : 'bg-transparent text-text-main hover:bg-state-hover'
                                                    }`}
                                                onClick={() => handlePresetSelect(preset)}
                                            >
                                                <button
                                                    className="flex-shrink-0 p-1 rounded-full hover:bg-white/10 transition-colors text-text-muted hover:text-text-highlighted"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        togglePreview(preset.url);
                                                    }}
                                                    title={previewingUrl === preset.url ? 'Stop preview' : 'Preview'}
                                                >
                                                    {previewingUrl === preset.url ? (
                                                        <TbPlayerPause className="icon-sm" />
                                                    ) : (
                                                        <TbPlayerPlay className="icon-sm" />
                                                    )}
                                                </button>
                                                <TbMusic className="icon-sm flex-shrink-0 text-text-muted" />
                                                <span className="text-sm truncate">{preset.name}</span>
                                                {isActive && (
                                                    <span className="chosen-dot ml-auto" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Custom Library */}
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-text-muted">Your Library</span>
                                    <button
                                        className={`flex items-center gap-1 text-xs transition-colors ${
                                            !canUploadMusic() || isUploading
                                                ? 'text-text-disabled cursor-not-allowed'
                                                : 'text-primary hover:text-primary-hover cursor-pointer'
                                        }`}
                                        onClick={() => canUploadMusic() && !isUploading && fileInputRef.current?.click()}
                                        title={!canUploadMusic() ? 'Library full (10/10) — delete a track to upload a new one' : isUploading ? 'Uploading...' : 'Upload music'}
                                    >
                                        <TbUpload className="icon-sm" />
                                        {isUploading ? 'Uploading...' : 'Upload'}
                                    </button>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        accept="audio/*"
                                        onChange={handleUpload}
                                    />
                                </div>

                                {customLibrary.length > 0 ? (
                                    <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto scrollbar-thin">
                                        {customLibrary.map((entry) => {
                                            const isActive = selectedCustomPath === entry.storagePath;
                                            const entryBlobUrl = blobUrls[entry.storagePath];
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isActive
                                                        ? 'bg-primary/15 text-primary'
                                                        : 'bg-transparent text-text-main hover:bg-state-hover'
                                                        }`}
                                                    onClick={() => handleCustomSelect(entry.storagePath)}
                                                >
                                                    <button
                                                        className="flex-shrink-0 p-1 rounded-full hover:bg-white/10 transition-colors text-text-muted hover:text-text-highlighted"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (previewingEntryId === entry.id && previewAudio) {
                                                                previewAudio.pause();
                                                                setPreviewAudio(null);
                                                                setPreviewingUrl(null);
                                                                setPreviewingEntryId(null);
                                                            } else {
                                                                if (!entryBlobUrl) return;
                                                                if (previewAudio) previewAudio.pause();
                                                                useUIStore.getState().setIsPlaying(false);
                                                                const audio = new Audio(entryBlobUrl);
                                                                audio.volume = music?.volume ?? 0.3;
                                                                audio.play().catch(console.error);
                                                                audio.onended = () => {
                                                                    setPreviewAudio(null);
                                                                    setPreviewingUrl(null);
                                                                    setPreviewingEntryId(null);
                                                                };
                                                                setPreviewAudio(audio);
                                                                setPreviewingUrl(entryBlobUrl);
                                                                setPreviewingEntryId(entry.id);
                                                            }
                                                        }}
                                                        title={previewingEntryId === entry.id ? 'Stop preview' : 'Preview'}
                                                    >
                                                        {previewingEntryId === entry.id ? (
                                                            <TbPlayerPause className="icon-sm" />
                                                        ) : (
                                                            <TbPlayerPlay className="icon-sm" />
                                                        )}
                                                    </button>
                                                    <TbMusic className="icon-sm flex-shrink-0 text-text-muted" />
                                                    <span className="text-sm truncate">{entry.name}</span>
                                                    {isActive && (
                                                        <span className="chosen-dot ml-auto mr-1" />
                                                    )}
                                                    <XButton
                                                        onClick={(e) => handleLibraryDelete(entry.id, entry.storagePath, e)}
                                                        title="Remove from library"
                                                        className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-xs text-text-disabled text-center py-3">
                                        No custom music uploaded yet
                                    </div>
                                )}
                            </div>

                        </>
                    )}
                </div>
            </CollapsibleCard>
        </div>
    );
};
