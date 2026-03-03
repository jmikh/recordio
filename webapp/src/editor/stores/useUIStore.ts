import { create } from 'zustand';
import type { ID, TimeMs, Size } from '../../types';
import type { WatermarkPosition } from '../../core/painters/watermarkPainter';
import { useProjectStore } from './useProjectStore';
import type { DisplaySettings } from '../../types/timeline';

export const CanvasMode = {
    Preview: 'preview',
    CropEdit: 'cropEdit',
    CameraEdit: 'cameraEdit',
    CameraLayoutEdit: 'cameraLayoutEdit',
    ZoomEdit: 'zoomEdit',
    SpotlightEdit: 'spotlightEdit',
    CaptionEdit: 'captionEdit',
} as const;
export type CanvasMode = typeof CanvasMode[keyof typeof CanvasMode];

export const SettingsPanel = {
    Screen: 'screen',
    Camera: 'camera',
    Export: 'export',
} as const;
export type SettingsPanel = typeof SettingsPanel[keyof typeof SettingsPanel];

export type SettingsPanelTab = 'screen' | 'effects' | 'background' | 'camera' | 'captions' | 'audio' | 'export';

export interface UIState {
    canvasMode: CanvasMode;
    selectedZoomId: ID | null;
    selectedSpotlightId: ID | null;
    selectedWindowId: ID | null;
    selectedCaptionId: ID | null;
    selectedCameraLayoutId: ID | null;
    selectedSettingsPanel: SettingsPanel;
    isResizingWindow: boolean;

    setCanvasMode: (mode: Exclude<CanvasMode, typeof CanvasMode.ZoomEdit | typeof CanvasMode.SpotlightEdit>) => void;
    setIsResizingWindow: (isResizing: boolean) => void;
    selectWindow: (id: ID | null) => void;
    selectZoom: (id: ID | null) => void;
    selectSpotlight: (id: ID | null) => void;
    selectCaption: (id: ID | null) => void;
    selectCameraLayout: (id: ID | null) => void;
    deselectAllSegments: () => void;
    setSettingsPanel: (panel: SettingsPanel) => void;

    // Settings Panel Active Tab (lifted from SettingsPanel local state)
    settingsPanelActiveTab: SettingsPanelTab;
    setSettingsPanelActiveTab: (tab: SettingsPanelTab) => void;

    // Timeline State
    timelineContainerRef: React.RefObject<HTMLDivElement | null> | null;
    setTimelineContainerRef: (ref: React.RefObject<HTMLDivElement | null> | null) => void;
    pixelsPerSec: number;
    setPixelsPerSec: (pps: number) => void;

    // Canvas Container Size (for DisplayMapper)
    canvasContainerSize: Size;
    setCanvasContainerSize: (size: Size) => void;

    // Playback State
    isPlaying: boolean;
    currentTimeMs: TimeMs;
    previewTimeMs: TimeMs | null;

    // Performance Monitoring
    // fps: number;
    // frameTime: number;
    // setFps: (fps: number) => void;
    // setFrameTime: (ms: number) => void;

    setIsPlaying: (playing: boolean) => void;
    setCurrentTime: (timeMs: TimeMs) => void;
    setPreviewTime: (timeMs: TimeMs | null) => void;

    // Debug Bar
    showDebugBar: boolean;
    toggleDebugBar: () => void;

    // Debug Overlays (focus areas on canvas)
    showDebugOverlays: boolean;
    toggleDebugOverlays: () => void;

    // Watermark Preview (live canvas preview when ExportSettings watermark is on)
    watermarkPreviewPosition: WatermarkPosition | null;
    setWatermarkPreviewPosition: (position: WatermarkPosition | null) => void;

    // Collapsible Card Visibility
    // -- Effects Settings
    showCollapsibleEffects: boolean;
    showCollapsibleMouse: boolean;
    // -- Background Settings
    showCollapsibleBackground: boolean;
    // -- Screen Settings
    showCollapsibleSize: boolean;
    showCollapsibleToolbar: boolean;
    showCollapsibleFrame: boolean;
    // -- Camera Settings
    showCollapsibleCameraShape: boolean;
    showCollapsibleShape: boolean;
    showCollapsibleBorder: boolean;
    // -- Captions Settings
    showCollapsibleCaptionAI: boolean;
    showCollapsibleCaptionStyle: boolean;
    showCollapsibleCaptionPosition: boolean;
    // -- Audio Settings
    showCollapsibleAudioToggles: boolean;
    showCollapsibleMusic: boolean;

    setCollapsibleVisibility: (key: string, value: boolean) => void;

    // Track Visibility & Collapse (delegates to ProjectStore timeline.displaySettings)
    setTrackShow: (key: keyof DisplaySettings, visible: boolean) => void;
    toggleTracksCollapsed: () => void;

    // Track Hover (for expand-on-hover)
    hoveredTrack: string | null;
    setHoveredTrack: (track: string | null) => void;

    // Explicit reset to default state
    reset: () => void;
}



export const useUIStore = create<UIState>((set, get) => ({
    // Initial State
    canvasMode: CanvasMode.Preview,
    selectedZoomId: null,
    selectedSpotlightId: null,
    selectedWindowId: null,
    selectedCaptionId: null,
    selectedCameraLayoutId: null,
    selectedSettingsPanel: SettingsPanel.Screen,
    settingsPanelActiveTab: 'screen' as SettingsPanelTab,
    isResizingWindow: false,

    setIsResizingWindow: (isResizingWindow) => set({ isResizingWindow }),

    // Selection Actions
    setCanvasMode: (canvasMode) => set({
        canvasMode,
        ...(canvasMode === CanvasMode.Preview ? { selectedZoomId: null, selectedSpotlightId: null, selectedWindowId: null, selectedCameraLayoutId: null } : { isPlaying: false })
    }),

    selectWindow: (selectedWindowId) => {
        if (selectedWindowId) {
            get().selectZoom(null);
            get().selectSpotlight(null);
            get().selectCaption(null);
            get().selectCameraLayout(null);
        }
        set({
            selectedWindowId,
            canvasMode: CanvasMode.Preview,
        });
    },

    selectZoom: (selectedZoomId) => {
        if (selectedZoomId) {
            get().selectSpotlight(null);
            get().selectCaption(null);
            get().selectWindow(null);
            get().selectCameraLayout(null);
        }
        set((state) => {
            if (selectedZoomId) {
                return {
                    selectedZoomId,
                    canvasMode: CanvasMode.ZoomEdit,
                    isPlaying: false,
                };
            }
            return { selectedZoomId: null, canvasMode: CanvasMode.Preview, };
        });
    },

    selectSpotlight: (selectedSpotlightId) => {
        if (selectedSpotlightId) {
            get().selectZoom(null);
            get().selectCaption(null);
            get().selectWindow(null);
            get().selectCameraLayout(null);
        }
        set((state) => {
            if (selectedSpotlightId) {
                return {
                    selectedSpotlightId,
                    canvasMode: CanvasMode.SpotlightEdit,
                    isPlaying: false,
                };
            }
            return { selectedSpotlightId: null, canvasMode: CanvasMode.Preview };
        });
    },

    selectCaption: (selectedCaptionId) => {
        if (selectedCaptionId) {
            get().selectZoom(null);
            get().selectSpotlight(null);
            get().selectWindow(null);
            get().selectCameraLayout(null);
        }
        set((state) => {
            if (selectedCaptionId) {
                // Also ensure captions track is visible in project timeline
                const ds = useProjectStore.getState().project.timeline.displaySettings;
                if (!ds.showCaptions) {
                    useProjectStore.setState(s => ({
                        project: {
                            ...s.project,
                            timeline: {
                                ...s.project.timeline,
                                displaySettings: { ...s.project.timeline.displaySettings, showCaptions: true }
                            }
                        }
                    }));
                }
                return {
                    selectedCaptionId,
                    selectedSettingsPanel: SettingsPanel.Screen,
                    settingsPanelActiveTab: 'captions' as SettingsPanelTab,
                    showCollapsibleCaptionPosition: true,
                };
            }

            return { selectedCaptionId: null };
        });
    },

    selectCameraLayout: (selectedCameraLayoutId) => {
        if (selectedCameraLayoutId) {
            get().selectZoom(null);
            get().selectSpotlight(null);
            get().selectCaption(null);
            get().selectWindow(null);
        }
        set((state) => {
            if (selectedCameraLayoutId) {
                return {
                    selectedCameraLayoutId,
                    canvasMode: CanvasMode.CameraLayoutEdit,
                    isPlaying: false,
                };
            }
            return { selectedCameraLayoutId: null, canvasMode: CanvasMode.Preview };
        });
    },

    deselectAllSegments: () => {
        get().selectZoom(null);
        get().selectSpotlight(null);
        get().selectWindow(null);
        get().selectCaption(null);
        get().selectCameraLayout(null);
        set({ canvasMode: CanvasMode.Preview });
    },

    setSettingsPanel: (selectedSettingsPanel) => set({ selectedSettingsPanel }),
    setSettingsPanelActiveTab: (settingsPanelActiveTab) => set({ settingsPanelActiveTab }),

    // Timeline State
    timelineContainerRef: null,
    setTimelineContainerRef: (timelineContainerRef) => set({ timelineContainerRef }),
    pixelsPerSec: 100, // Default zoom level

    // Canvas Container Size (for DisplayMapper)
    canvasContainerSize: { width: 0, height: 0 },
    setCanvasContainerSize: (canvasContainerSize) => set({ canvasContainerSize }),

    // Playback State
    isPlaying: false,
    currentTimeMs: 0,
    previewTimeMs: null,

    // Performance Monitoring
    // fps: 0,
    // frameTime: 0,
    // setFps: (fps) => set({ fps }),
    // setFrameTime: (frameTime) => set({ frameTime }),

    setPixelsPerSec: (pixelsPerSec) => set({ pixelsPerSec }),

    setIsPlaying: (isPlaying) => set({ isPlaying, canvasMode: CanvasMode.Preview, selectedZoomId: null, selectedSpotlightId: null, selectedCameraLayoutId: null }),
    setCurrentTime: (currentTimeMs) => {
        const state = get();
        const container = state.timelineContainerRef?.current;

        // Auto-scroll timeline if CTI is outside visible viewport (page-flip logic)
        if (container && !state.isPlaying) {
            const px = (currentTimeMs / 1000) * state.pixelsPerSec;
            const scrollLeft = container.scrollLeft;
            const clientWidth = container.clientWidth;

            if (px > scrollLeft + clientWidth || px < scrollLeft) {
                // Center the CTI in the viewport
                container.scrollTo({ left: px - clientWidth / 2, behavior: 'auto' });
            }
        }

        set({ currentTimeMs });
    },
    setPreviewTime: (previewTimeMs) => set({ previewTimeMs }),

    // Debug Bar
    showDebugBar: false,
    toggleDebugBar: () => set((state) => ({ showDebugBar: !state.showDebugBar })),

    // Debug Overlays
    showDebugOverlays: false,
    toggleDebugOverlays: () => set((state) => ({ showDebugOverlays: !state.showDebugOverlays })),

    // Watermark Preview
    watermarkPreviewPosition: null,
    setWatermarkPreviewPosition: (position) => set({ watermarkPreviewPosition: position }),

    // Collapsible Card Visibility
    // -- Effects Settings
    showCollapsibleEffects: false,
    showCollapsibleMouse: false,
    // -- Background Settings
    showCollapsibleBackground: true, // Default expanded
    // -- Screen Settings
    showCollapsibleSize: false,
    showCollapsibleToolbar: false,
    showCollapsibleFrame: false,
    // -- Camera Settings
    showCollapsibleCameraShape: true, // Default expanded
    showCollapsibleShape: true, // Default expanded
    showCollapsibleBorder: false,
    // -- Captions Settings
    showCollapsibleCaptionAI: true, // Default expanded
    showCollapsibleCaptionStyle: true, // Default expanded
    showCollapsibleCaptionPosition: false,
    // -- Audio Settings
    showCollapsibleAudioToggles: true, // Default expanded
    showCollapsibleMusic: true, // Default expanded

    setCollapsibleVisibility: (key, value) => set({ [key]: value } as Partial<UIState>),

    // Track Visibility & Collapse (delegates to ProjectStore timeline.displaySettings)
    setTrackShow: (key, visible) => {
        useProjectStore.setState(s => ({
            project: {
                ...s.project,
                timeline: {
                    ...s.project.timeline,
                    displaySettings: { ...s.project.timeline.displaySettings, [key]: visible }
                }
            }
        }));
    },
    toggleTracksCollapsed: () => {
        const current = useProjectStore.getState().project.timeline.displaySettings.collapsed;
        useProjectStore.setState(s => ({
            project: {
                ...s.project,
                timeline: {
                    ...s.project.timeline,
                    displaySettings: { ...s.project.timeline.displaySettings, collapsed: !current }
                }
            }
        }));
    },

    // Track Hover
    hoveredTrack: null,
    setHoveredTrack: (hoveredTrack) => set({ hoveredTrack }),

    reset: () => {
        get().selectCaption(null);
        set({
            canvasMode: CanvasMode.Preview,
            selectedZoomId: null,
            selectedSpotlightId: null,
            selectedWindowId: null,
            selectedCaptionId: null,
            selectedCameraLayoutId: null,
            selectedSettingsPanel: SettingsPanel.Screen,
            settingsPanelActiveTab: 'screen' as SettingsPanelTab,
            timelineContainerRef: null,
            pixelsPerSec: 100,
            isPlaying: false,
            currentTimeMs: 0,
            previewTimeMs: null,
            // fps: 0,
            // frameTime: 0,
            isResizingWindow: false,
            showDebugBar: false,
            showDebugOverlays: false,
            // Collapsible Card Visibility
            showCollapsibleEffects: false,
            showCollapsibleMouse: false,
            showCollapsibleBackground: true,
            showCollapsibleSize: false,
            showCollapsibleToolbar: false,
            showCollapsibleFrame: false,
            showCollapsibleCameraShape: true,
            showCollapsibleShape: true,
            showCollapsibleBorder: false,
            showCollapsibleCaptionAI: true,
            showCollapsibleCaptionStyle: true,
            showCollapsibleCaptionPosition: false,
            showCollapsibleAudioToggles: true,
            showCollapsibleMusic: true,

            hoveredTrack: null,
        });
    }
}));
