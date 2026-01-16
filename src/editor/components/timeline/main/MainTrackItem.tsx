import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { OutputWindow } from '../../../../core/types';
import { WaveformSegment } from '../WaveformSegment';
import type { DragState } from './useWindowDrag';
import type { AudioAnalysisResult } from '../../../hooks/useAudioAnalysis';

export const GROUP_HEADER_HEIGHT = 24;

interface MainTrackItemProps {
    outputWindow: OutputWindow;
    dragState: DragState | null;
    isSelected: boolean;
    left: number;
    width: number;
    trackContentHeight: number;
    selectWindow: (id: string | null) => void;
    handleDragStart: (e: React.MouseEvent, id: string, type: 'left' | 'right') => void;
    setSpeedControlState: React.Dispatch<React.SetStateAction<{
        windowId: string;
        speed: number;
        anchorEl: HTMLElement;
    } | null>>;
    containerRef: React.RefObject<HTMLDivElement | null>;
    screenAudio: AudioAnalysisResult;
    cameraAudio: AudioAnalysisResult;
    isMuted: boolean;
    hasCamera: boolean;
}

export const MainTrackItem: React.FC<MainTrackItemProps> = ({
    outputWindow: w,
    dragState,
    isSelected,
    left,
    width,
    trackContentHeight,
    selectWindow,
    handleDragStart,
    setSpeedControlState,
    containerRef,
    screenAudio,
    cameraAudio,
    isMuted,
    hasCamera,
}) => {
    // Determine the effective window to display (dragged vs original)
    const win = (dragState && dragState.windowId === w.id) ? dragState.currentWindow : w;

    const sourceStartMs = win.startMs;
    const sourceEndMs = win.endMs;
    const speed = win.speed || 1.0;
    const outputDurationMs = (win.endMs - win.startMs) / speed;

    const hasScreenAudio = !screenAudio.isLoading && screenAudio.peaks.length > 0;
    const hasCameraAudio = hasCamera && !cameraAudio.isLoading && cameraAudio.peaks.length > 0;

    // Logic:
    // If muted -> Show Camera (if avail)
    // If not muted ->
    //    If both -> Combine
    //    If only screen -> Screen
    //    If only camera -> Camera
    //    If neither -> None

    const displayMode = (() => {
        if (isMuted) {
            return hasCameraAudio ? 'camera' : 'none';
        }
        if (hasScreenAudio && hasCameraAudio) return 'combined';
        if (hasScreenAudio) return 'screen';
        if (hasCameraAudio) return 'camera';
        return 'none';
    })();

    const displayPeaks = useMemo(() => {
        if (displayMode === 'none') return [];
        if (displayMode === 'screen') return screenAudio.peaks;
        if (displayMode === 'camera') return cameraAudio.peaks;

        // Combined
        const len = Math.max(screenAudio.peaks.length, cameraAudio.peaks.length);
        const merged: number[] = new Array(len).fill(0);
        for (let i = 0; i < len; i++) {
            const s = screenAudio.peaks[i] || 0;
            const c = cameraAudio.peaks[i] || 0;
            // Summing for "combined" effect so it looks fuller
            merged[i] = Math.min(1, s + c);
        }
        return merged;
    }, [displayMode, screenAudio.peaks, cameraAudio.peaks]);

    return (
        <div
            className="absolute top-0 bottom-0"
            style={{ left: `${left}px`, width: `${width}px` }}
            onClick={(e) => {
                e.stopPropagation();
                selectWindow(w.id);
            }}
        >
            {/* Visual Window Content (Clipped) */}
            <div className={`absolute inset-0 group border rounded-lg overflow-hidden flex flex-col transition-colors ${isSelected ? 'border-secondary' : 'border-primary-muted hover:border-border-primary'}`}>
                {/* Group Header */}
                <div
                    style={{ height: GROUP_HEADER_HEIGHT }}
                    className="bg-surface-elevated border-b border-border px-2 flex items-center justify-start gap-2 text-xs text-text-main select-none"
                >
                    {/* Speed - always show (prioritized) */}
                    <span
                        className="cursor-pointer hover:text-primary transition-colors"
                        onClick={(e) => {
                            e.stopPropagation();
                            setSpeedControlState({
                                windowId: w.id,
                                speed: win.speed || 1.0,
                                anchorEl: e.currentTarget as HTMLElement
                            });
                        }}
                    >
                        {(() => {
                            const speed = win.speed || 1.0;
                            // Format to remove trailing zeros
                            const formatted = speed.toFixed(2).replace(/\.?0+$/, '');
                            return `${formatted}x`;
                        })()}
                    </span>

                    {/* Duration - hide if window too small, less priority than speed */}
                    {width >= 70 && <span>{(outputDurationMs / 1000).toFixed(1)}s</span>}
                </div>

                {/* Tracks Area */}
                <div className="relative flex-1 w-full">
                    {/* Unified Segment */}
                    <div className={`absolute left-0 right-0 top-0 bottom-0 overflow-hidden transition-all cursor-pointer box-border flex items-center justify-center`}>

                        {/* Background fill - highlighted when selected or hovering */}
                        <div className={`absolute inset-0 transition-colors ${isSelected ? 'bg-primary-highlighted' : 'bg-primary group-hover:bg-primary-highlighted'}`} />

                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden z-10">
                            {displayMode !== 'none' && (
                                <WaveformSegment
                                    peaks={displayPeaks}
                                    sourceStartMs={sourceStartMs}
                                    sourceEndMs={sourceEndMs}
                                    width={width}
                                    height={trackContentHeight}
                                    color="rgba(255,255,255,0.7)"
                                />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Resize Handles (Overlay entire group) */}
            <div
                className="absolute top-0 bottom-0 left-0 w-3 cursor-ew-resize hover:bg-hover-bold z-20 rounded-l-lg"
                onMouseDown={(e) => handleDragStart(e, w.id, 'left')}
            />
            <div
                className="absolute top-0 bottom-0 right-0 w-3 cursor-ew-resize hover:bg-hover-bold z-20 rounded-r-lg"
                onMouseDown={(e) => handleDragStart(e, w.id, 'right')}
            />

            {/* Gap Bubble (Portal) */}
            {dragState && dragState.windowId === w.id && (() => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) return null;

                const isLeft = dragState.type === 'left';
                const indicatorX = rect.left + left + (isLeft ? 0 : width);
                const indicatorY = rect.bottom;

                // Calculate remaining gap to constraints (how much room left before hitting edge)
                const currentWin = dragState.currentWindow;
                const remainingGapMs = isLeft
                    ? (currentWin.startMs - dragState.constraints.minStart)
                    : (dragState.constraints.maxEnd - currentWin.endMs);

                return createPortal(
                    <div
                        className="fixed z-[9999] pointer-events-none"
                        style={{
                            top: `${indicatorY}px`,
                            left: `${indicatorX}px`,
                            transform: 'translate(-50%, 8px)'
                        }}
                    >
                        <div className="relative rounded-lg bg-secondary text-text-on-secondary text-[10px] font-mono px-1.5 py-0.5 rounded shadow-xl border border-border whitespace-nowrap before:content-[''] before:absolute before:top-0 before:left-1/2 before:-translate-x-1/2 before:-translate-y-full before:border-[8px] before:border-transparent before:border-b-border before:z-10 after:content-[''] after:absolute after:top-0 after:left-1/2 after:-translate-x-1/2 after:-translate-y-[calc(100%-1px)] after:border-[8px] after:border-transparent after:border-b-secondary after:z-20">
                            {(remainingGapMs / 1000).toFixed(2)}s
                        </div>
                    </div>,
                    document.body
                );
            })()}
        </div>
    );
};
