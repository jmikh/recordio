import { create } from 'zustand';


export interface Metadata {
    timestamp: number;
    tagName: string;
    x: number;
    y: number;
    width: number;
    height: number;
}


interface EditorState {
    videoUrl: string | null;
    metadata: Metadata[];
    recordingStartTime: number;
    isExporting: boolean;
    zoomIntensity: number;
    paddingPercentage: number;
    outputVideoSize: { width: number; height: number };
    inputVideoSize: { width: number; height: number } | null;

    setVideoUrl: (url: string | null) => void;
    setMetadata: (metadata: Metadata[]) => void;
    addMetadataItem: (item: Metadata) => void;
    removeMetadataItem: (index: number) => void;
    setRecordingStartTime: (time: number) => void;
    setIsExporting: (isExporting: boolean) => void;
    setZoomIntensity: (intensity: number) => void;
    setPaddingPercentage: (percentage: number) => void;
    setOutputVideoSize: (size: { width: number; height: number }) => void;
    setInputVideoSize: (size: { width: number; height: number }) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
    videoUrl: null,
    metadata: [],
    recordingStartTime: 0,
    isExporting: false,
    zoomIntensity: 2.0,
    paddingPercentage: 0.05,
    outputVideoSize: { width: 3840, height: 2160 },
    inputVideoSize: null,

    setVideoUrl: (url) => set({ videoUrl: url }),
    setMetadata: (metadata) => set({ metadata }),
    addMetadataItem: (item) => set((state) => ({
        metadata: [...state.metadata, item].sort((a, b) => a.timestamp - b.timestamp)
    })),
    removeMetadataItem: (index) => set((state) => ({
        metadata: state.metadata.filter((_, i) => i !== index)
    })),
    setRecordingStartTime: (time) => set({ recordingStartTime: time }),
    setIsExporting: (isExporting) => set({ isExporting }),
    setZoomIntensity: (intensity) => set({ zoomIntensity: intensity }),
    setPaddingPercentage: (percentage) => set({ paddingPercentage: percentage }),
    setOutputVideoSize: (size) => set({ outputVideoSize: size }),
    setInputVideoSize: (size) => set({ inputVideoSize: size }),
}));
