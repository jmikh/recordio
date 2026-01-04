// ... imports
import React, { useState, useEffect } from 'react';
import type { OutputWindow, Timeline as TimelineType } from '../../../core/types';
import { useProjectStore, useProjectSources } from '../../stores/useProjectStore';
import { useAudioAnalysis } from '../../hooks/useAudioAnalysis';
import { WaveformSegment } from './WaveformSegment';
import { TimelineTrackHeader } from './TimelineTrackHeader';

export const GROUP_HEADER_HEIGHT = 24;

interface MainTrackProps {
    timeline: TimelineType;
    pixelsPerSec: number;
    accumulatedX: number; // For layout positioning if needed, but we mostly use absolute based on prev widths
    trackHeight: number;
    headerWidth: number;
}

interface DragState {
    windowId: string;
    type: 'left' | 'right' | 'move';
    startX: number;
    initialWindow: OutputWindow;
    currentWindow: OutputWindow;
    constraints: {
        minStart: number;
        maxEnd: number;
    };
}

export const MainTrack: React.FC<MainTrackProps> = ({
    timeline,
    pixelsPerSec,
    trackHeight,
    headerWidth,
}) => {
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const sources = useProjectSources();
    const [dragState, setDragState] = useState<DragState | null>(null);

    // Prepare Audio Analysis for Screen and Camera
    const screenSourceId = timeline.recording.screenSourceId;
    const cameraSourceId = timeline.recording.cameraSourceId;

    const screenSource = sources[screenSourceId];
    const cameraSource = cameraSourceId ? sources[cameraSourceId] : null;

    const screenAudio = useAudioAnalysis(screenSourceId, screenSource?.url);
    const cameraAudio = useAudioAnalysis(cameraSourceId || '', cameraSource?.url || '');

    // --- Dragging Logic ---
    useEffect(() => {
        if (!dragState) return;

        const handleGlobalMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - dragState.startX;
            const deltaMs = (deltaX / pixelsPerSec) * 1000;
            const win = dragState.initialWindow;
            const { minStart, maxEnd } = dragState.constraints;

            let newWindow = { ...win };

            if (dragState.type === 'left') {
                const proposedStart = win.startMs + deltaMs;
                // Cannot go before minStart, cannot cross endMs (min dur 100ms)
                newWindow.startMs = Math.min(Math.max(proposedStart, minStart), win.endMs - 100);
            } else if (dragState.type === 'right') {
                const proposedEnd = win.endMs + deltaMs;
                // Cannot go past maxEnd, cannot cross startMs
                newWindow.endMs = Math.max(Math.min(proposedEnd, maxEnd), win.startMs + 100);
            } else if (dragState.type === 'move') {
                const duration = win.endMs - win.startMs;
                const proposedStart = win.startMs + deltaMs;

                let safeStart = Math.max(proposedStart, minStart);
                let safeEnd = safeStart + duration;

                if (safeEnd > maxEnd) {
                    safeEnd = maxEnd;
                    safeStart = safeEnd - duration;
                }

                newWindow.startMs = safeStart;
                newWindow.endMs = safeEnd;
            }

            setDragState(prev => prev ? { ...prev, currentWindow: newWindow } : null);
        };

        const handleGlobalMouseUp = () => {
            if (dragState) {
                updateOutputWindow(dragState.windowId, dragState.currentWindow);
            }
            setDragState(null);
        };

        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [dragState, pixelsPerSec, updateOutputWindow]);

    const handleDragStart = (e: React.MouseEvent, id: string, type: 'left' | 'right' | 'move') => {
        e.preventDefault();
        e.stopPropagation();

        const winIndex = timeline.outputWindows.findIndex(w => w.id === id);
        if (winIndex === -1) return;
        const win = timeline.outputWindows[winIndex];

        let minStart = 0;
        let maxEnd = timeline.durationMs || 10000;

        if (winIndex > 0) {
            minStart = timeline.outputWindows[winIndex - 1].endMs;
        }
        if (winIndex < timeline.outputWindows.length - 1) {
            maxEnd = timeline.outputWindows[winIndex + 1].startMs;
        }

        setDragState({
            windowId: id,
            type,
            startX: e.clientX,
            initialWindow: win,
            currentWindow: win,
            constraints: { minStart, maxEnd }
        });
    };

    // Calculate layout
    let currentX = 0;
    const trackContentHeight = Math.max(0, trackHeight - GROUP_HEADER_HEIGHT);

    return (
        <div className="w-full relative bg-[#2a2a2a]/50 flex" style={{ height: trackHeight }}>
            {/* Sticky Header */}
            <div className="sticky left-0 z-20 flex-shrink-0 flex flex-col" style={{ width: headerWidth }}>
                <div style={{ height: GROUP_HEADER_HEIGHT }} className="border-b border-white/5" />
                {!!cameraSourceId ? (
                    <div className="flex flex-col flex-1">
                        <TimelineTrackHeader
                            title="Screen"
                            height={trackContentHeight / 2}
                            hasAudio={true}
                            isMuted={useProjectStore(s => s.mutedSources[screenSourceId])}
                            onToggleMute={() => useProjectStore.getState().toggleSourceMute(screenSourceId)}
                        />
                        <TimelineTrackHeader
                            title="Camera"
                            height={trackContentHeight / 2}
                            hasAudio={true}
                            isMuted={useProjectStore(s => s.mutedSources[cameraSourceId])}
                            onToggleMute={() => useProjectStore.getState().toggleSourceMute(cameraSourceId)}
                        />
                    </div>
                ) : (
                    <TimelineTrackHeader
                        title="Screen"
                        height={trackContentHeight}
                        hasAudio={true}
                        isMuted={useProjectStore(s => s.mutedSources[screenSourceId])}
                        onToggleMute={() => useProjectStore.getState().toggleSourceMute(screenSourceId)}
                    />
                )}
            </div>

            {/* Content Container */}
            <div className="relative flex-1" style={{ height: trackHeight }}>

                {timeline.outputWindows.map((w) => {
                    const win = (dragState && dragState.windowId === w.id) ? dragState.currentWindow : w;
                    const durationMs = win.endMs - win.startMs;
                    const left = currentX;
                    const width = (durationMs / 1000) * pixelsPerSec;
                    currentX += width; // Accumulate for next window

                    const hasCamera = !!timeline.recording.cameraSourceId;
                    const sourceStartMs = win.startMs;
                    const sourceEndMs = win.endMs;

                    return (
                        <div
                            key={w.id}
                            className="absolute top-0 bottom-0 group border border-white/20 rounded-lg overflow-hidden flex flex-col hover:border-white/40 transition-colors"
                            style={{ left: `${left}px`, width: `${width}px` }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => handleDragStart(e, w.id, 'move')}
                        >
                            {/* Group Header */}
                            <div
                                style={{ height: GROUP_HEADER_HEIGHT }}
                                className="bg-white/5 border-b border-white/10 px-2 flex items-center text-xs text-white/50 select-none"
                            >
                                {(durationMs / 1000).toFixed(1)}s
                            </div>

                            {/* Tracks Area */}
                            <div className="relative flex-1 w-full">
                                {/* 1. Screen Segment */}
                                <div className={`absolute left-0 right-0 top-0 ${hasCamera ? 'bottom-1/2' : 'bottom-0'} bg-blue-900/60 border-y border-blue-500/40 first:border-t-0 last:border-b-0 overflow-hidden hover:brightness-110 active:brightness-125 transition-all cursor-pointer box-border flex items-center justify-center`}>
                                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                                        {!screenAudio.isLoading && (
                                            <WaveformSegment
                                                peaks={screenAudio.peaks}
                                                sourceStartMs={sourceStartMs}
                                                sourceEndMs={sourceEndMs}
                                                width={width}
                                                height={hasCamera ? trackContentHeight / 2 : trackContentHeight}
                                                color="#bfdbfe" // blue-200
                                            />
                                        )}
                                    </div>
                                </div>


                                {/* 2. Camera Segment (if exists) */}
                                {
                                    hasCamera && (
                                        <div className="absolute left-0 right-0 bottom-0 top-1/2 bg-purple-900/60 border-b border-purple-500/40 overflow-hidden hover:brightness-110 active:brightness-125 transition-all cursor-pointer box-border flex items-center justify-center">
                                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
                                                {!cameraAudio.isLoading && (
                                                    <WaveformSegment
                                                        peaks={cameraAudio.peaks}
                                                        sourceStartMs={sourceStartMs}
                                                        sourceEndMs={sourceEndMs}
                                                        width={width}
                                                        height={trackContentHeight / 2}
                                                        color="#e9d5ff" // purple-200
                                                    />
                                                )}
                                            </div>
                                        </div>

                                    )}
                            </div>

                            {/* Resize Handles (Overlay entire group) */}
                            <div
                                className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-white/10 z-20"
                                onMouseDown={(e) => handleDragStart(e, w.id, 'left')}
                            />
                            <div
                                className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-white/10 z-20"
                                onMouseDown={(e) => handleDragStart(e, w.id, 'right')}
                            />
                        </div>
                    );
                })}
            </div >
        </div >
    );
};
