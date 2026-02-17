import { useRef, useState, useEffect, useCallback } from 'react';
import { useProjectStore, useProjectData } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Toggle, Slider, CollapsibleCard, XButton } from '@shared/components';
import type { PreviewItem } from '@shared/components';
import { ProjectStorage, type CustomMusicEntry } from '../../../storage/projectStorage';
import { TbMusic, TbUpload, TbPlayerPlay, TbPlayerPause } from 'react-icons/tb';

// CDN preset music tracks
const PRESET_MUSIC = [
    { name: 'Ambient', url: 'https://cdn.recordio.cc/music/ambient.mp3' },
    { name: 'Bassy', url: 'https://cdn.recordio.cc/music/bassy.mp3' },
    { name: 'Energetic', url: 'https://cdn.recordio.cc/music/energetic.mp3' },
    { name: 'Lo-Fi 1', url: 'https://cdn.recordio.cc/music/lofi 1.mp3' },
    { name: 'Lo-Fi 2', url: 'https://cdn.recordio.cc/music/lofi 2.mp3' },
];

export const AudioSettingsPanel = () => {
    const project = useProjectData();
    const updateSettings = useProjectStore(s => s.updateSettings);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Collapsible state
    const showCollapsibleAudioToggles = useUIStore(s => s.showCollapsibleAudioToggles);
    const showCollapsibleMusic = useUIStore(s => s.showCollapsibleMusic);
    const setCollapsibleVisibility = useUIStore(s => s.setCollapsibleVisibility);

    // Custom music library state
    const [customLibrary, setCustomLibrary] = useState<CustomMusicEntry[]>([]);

    // Audio preview state
    const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
    const [previewingUrl, setPreviewingUrl] = useState<string | null>(null);
    const [previewingEntryId, setPreviewingEntryId] = useState<string | null>(null);

    // Undo/redo batching
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();

    // Load custom music library
    const loadLibrary = useCallback(async () => {
        const entries = await ProjectStorage.listCustomMusic();
        setCustomLibrary(entries);
    }, []);

    useEffect(() => {
        loadLibrary();
    }, []);

    // Cleanup preview audio on unmount
    useEffect(() => {
        return () => {
            if (previewAudio) {
                previewAudio.pause();
                previewAudio.src = '';
            }
        };
    }, [previewAudio]);

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

    // Determine audio mode for toggle display
    const screenSource = project.screenSource;
    const cameraSource = project.cameraSource;
    const screenHasAudio = screenSource?.hasAudio ?? false;
    const isSingleMode = screenSource?.hasMicrophone && !cameraSource;
    const isDualMode = !!cameraSource;
    const hasMicOnCamera = cameraSource?.hasMicrophone ?? false;
    const hasMicAnywhere = screenSource?.hasMicrophone || hasMicOnCamera;

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
                    customStorageUrl: undefined,
                    customRuntimeUrl: undefined,
                    customLibraryId: undefined,
                },
            },
        });
    };

    const handleCustomSelect = async (entry: CustomMusicEntry) => {
        const runtimeUrl = URL.createObjectURL(entry.blob);

        // Store blob in project recordings for persistence
        const blobId = `audio-music-${entry.id}`;
        await ProjectStorage.saveRecordingBlob(blobId, entry.blob);
        const storageUrl = `recordio-blob://${blobId}`;

        updateSettings({
            audio: {
                music: {
                    enabled: true,
                    source: 'custom',
                    presetUrl: undefined,
                    presetName: undefined,
                    customStorageUrl: storageUrl,
                    customRuntimeUrl: runtimeUrl,
                    customLibraryId: entry.id,
                },
            },
        });
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            // Save to global library
            const libraryId = await ProjectStorage.saveCustomMusic(file, file.name);

            // Store blob in project recordings for persistence
            const blobId = `audio-music-${libraryId}`;
            await ProjectStorage.saveRecordingBlob(blobId, file);
            const storageUrl = `recordio-blob://${blobId}`;
            const runtimeUrl = URL.createObjectURL(file);

            updateSettings({
                audio: {
                    music: {
                        enabled: true,
                        source: 'custom',
                        presetUrl: undefined,
                        presetName: undefined,
                        customStorageUrl: storageUrl,
                        customRuntimeUrl: runtimeUrl,
                        customLibraryId: libraryId,
                    },
                },
            });

            await loadLibrary();
        } catch (err) {
            console.error('Failed to upload music', err);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleLibraryDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();

        // Stop preview if this entry is being previewed
        if (previewingEntryId === id && previewAudio) {
            previewAudio.pause();
            if (previewingUrl) URL.revokeObjectURL(previewingUrl);
            setPreviewAudio(null);
            setPreviewingUrl(null);
            setPreviewingEntryId(null);
        }

        await ProjectStorage.deleteCustomMusic(id);
        await loadLibrary();
    };

    // Build preview items for audio toggles card
    const audioTogglePreviewItems: PreviewItem[] = [];
    if (isSingleMode && audio?.muteScreenAudio) {
        audioTogglePreviewItems.push({ type: 'text', content: 'Muted' });
    } else if (isDualMode) {
        if (audio?.muteScreenAudio) audioTogglePreviewItems.push({ type: 'text', content: 'Screen muted' });
        if (audio?.muteMicrophone) audioTogglePreviewItems.push({ type: 'text', content: 'Mic muted' });
    }
    if (audioTogglePreviewItems.length === 0 && (screenHasAudio || hasMicAnywhere)) {
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
    const selectedCustomId = music?.source === 'custom' ? music.customLibraryId : undefined;

    return (
        <div className="flex flex-col gap-2">
            {/* Audio Source Toggles */}
            {(screenHasAudio || hasMicAnywhere) && (
                <CollapsibleCard
                    title="Audio"
                    previewItems={audioTogglePreviewItems}
                    isExpanded={showCollapsibleAudioToggles}
                    onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleAudioToggles', v)}
                >
                    <div className="flex flex-col gap-3">
                        {isSingleMode ? (
                            /* Single Mode: one combined toggle + volume */
                            <>
                                <Toggle
                                    label="Recording Audio"
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
                            /* Dual Mode: separate toggles + volumes */
                            <>
                                {screenHasAudio && (
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
                                )}
                                {hasMicOnCamera && (
                                    <>
                                        <Toggle
                                            label="Microphone Audio"
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
                                )}
                            </>
                        )}
                    </div>
                </CollapsibleCard>
            )}

            {/* Background Music */}
            <CollapsibleCard
                title="Music"
                previewItems={musicPreviewItems}
                isExpanded={showCollapsibleMusic}
                onExpandChange={(v) => setCollapsibleVisibility('showCollapsibleMusic', v)}
            >
                <div className="flex flex-col gap-4 text-sm select-none">
                    {/* Enable toggle */}
                    <Toggle
                        label="Enable Music"
                        value={music?.enabled ?? false}
                        onChange={(v) => {
                            if (v && !music?.presetUrl && !music?.customRuntimeUrl) {
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
                                                        <TbPlayerPause size={14} />
                                                    ) : (
                                                        <TbPlayerPlay size={14} />
                                                    )}
                                                </button>
                                                <TbMusic size={14} className="flex-shrink-0 text-text-muted" />
                                                <span className="text-sm truncate">{preset.name}</span>
                                                {isActive && (
                                                    <span className="ml-auto text-xs text-primary">●</span>
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
                                        className="flex items-center gap-1 text-xs text-primary hover:text-primary-hover transition-colors cursor-pointer"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <TbUpload size={12} />
                                        Upload
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
                                            const isActive = selectedCustomId === entry.id;
                                            return (
                                                <div
                                                    key={entry.id}
                                                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isActive
                                                        ? 'bg-primary/15 text-primary'
                                                        : 'bg-transparent text-text-main hover:bg-state-hover'
                                                        }`}
                                                    onClick={() => handleCustomSelect(entry)}
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
                                                                if (previewAudio) previewAudio.pause();
                                                                useUIStore.getState().setIsPlaying(false);
                                                                const blobUrl = URL.createObjectURL(entry.blob);
                                                                const audio = new Audio(blobUrl);
                                                                audio.volume = music?.volume ?? 0.3;
                                                                audio.play().catch(console.error);
                                                                audio.onended = () => {
                                                                    setPreviewAudio(null);
                                                                    setPreviewingUrl(null);
                                                                    setPreviewingEntryId(null);
                                                                };
                                                                setPreviewAudio(audio);
                                                                setPreviewingUrl(blobUrl);
                                                                setPreviewingEntryId(entry.id);
                                                            }
                                                        }}
                                                        title={previewingEntryId === entry.id ? 'Stop preview' : 'Preview'}
                                                    >
                                                        {previewingEntryId === entry.id ? (
                                                            <TbPlayerPause size={14} />
                                                        ) : (
                                                            <TbPlayerPlay size={14} />
                                                        )}
                                                    </button>
                                                    <TbMusic size={14} className="flex-shrink-0 text-text-muted" />
                                                    <span className="text-sm truncate">{entry.name}</span>
                                                    {isActive && (
                                                        <span className="text-xs text-primary ml-auto mr-1">●</span>
                                                    )}
                                                    {!isActive && (
                                                        <XButton
                                                            onClick={(e) => handleLibraryDelete(entry.id, e)}
                                                            title="Remove from library"
                                                            className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                                                        />
                                                    )}
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

                            {/* Fade Out */}
                            <div className="flex flex-col gap-3 pt-1 border-t border-border">
                                <Toggle
                                    label="Fade Out"
                                    value={music.fadeOut ?? true}
                                    onChange={(v) => updateSettings({ audio: { music: { fadeOut: v } } })}
                                />

                                {music.fadeOut && (
                                    <Slider
                                        label="Duration"
                                        min={10}
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
                                )}
                            </div>
                        </>
                    )}
                </div>
            </CollapsibleCard>
        </div>
    );
};
