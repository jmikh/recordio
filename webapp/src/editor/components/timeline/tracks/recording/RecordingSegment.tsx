import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { OutputWindow } from '../../../../../types';
import { StaticAudioWave } from './StaticAudioWave';
import { blockBorder, holdShapeBase, resizeHandle, dragHandleIndicator, SEGMENT_RADIUS } from '../shared/TimelineBlockStyles';
import type { DragState } from './useWindowDrag';
import type { AudioAnalysisResult } from '../../../../hooks/useAudioAnalysis';

interface RecordingSegmentProps {
    outputWindow: OutputWindow;
    dragState: DragState | null;
    isSelected: boolean;
    left: number;
    width: number;
    trackContentHeight: number;
    selectWindow: (id: string | null) => void;
    handleDragStart: (e: React.MouseEvent, id: string, type: 'left' | 'right') => void;
    containerRef: React.RefObject<HTMLDivElement | null>;
    screenAudio: AudioAnalysisResult;
    cameraAudio: AudioAnalysisResult;
    isMuted: boolean;
    hasCamera: boolean;
    scrollLeft: number;
    containerWidth: number;
}

export const RecordingSegment: React.FC<RecordingSegmentProps> = ({
    outputWindow: seg,
    dragState,
    isSelected,
    left,
    width,
    trackContentHeight,
    selectWindow,
    handleDragStart,
    containerRef,
    screenAudio,
    cameraAudio,
    isMuted,
    hasCamera,
    scrollLeft,
    containerWidth,
}) => {
    // Determine the effective window to display (dragged vs original)
    const win = (dragState && dragState.windowId === seg.id) ? dragState.currentWindow : seg;

    const sourceStartTimeMs = win.startMs;
    const sourceEndTimeMs = win.endMs;
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

    const segmentHeight = trackContentHeight - 2;

    return (
        <div
            className={`absolute [--block-bg:var(--primary)] group`}
            style={{ left: `${left}px`, width: `${width}px`, height: trackContentHeight }}
            onMouseDown={() => {
                // Just handle selection (no deselect on re-click)
                // Let event bubble up to Timeline for CTI movement
                selectWindow(seg.id);
            }}
        >
            {/* Main block — border + background (matching other tracks: top:1, height: trackHeight-2) */}
            <div
                className={`absolute left-0 right-0 overflow-hidden cursor-pointer flex items-center transition-colors ${blockBorder.base} ${isSelected ? blockBorder.selected : blockBorder.highlighted}`}
                style={{
                    top: 1,
                    height: segmentHeight,
                    ...holdShapeBase(segmentHeight),
                    borderRadius: SEGMENT_RADIUS,
                }}
            >
                {/* Audio Waveform */}
                <div className="absolute inset-0 pointer-events-none flex items-end justify-center overflow-hidden z-10">
                    {displayMode !== 'none' && (
                        <StaticAudioWave
                            peaks={displayPeaks}
                            sourceStartTimeMs={sourceStartTimeMs}
                            sourceEndTimeMs={sourceEndTimeMs}
                            width={width}
                            height={segmentHeight}
                            scrollLeft={scrollLeft}
                            containerWidth={containerWidth}
                            segmentLeft={left}
                        />
                    )}
                </div>

                {/* Speed & Duration Labels (overlaid on the block) */}
                {width >= 40 && (
                    <div className="absolute top-[1px] left-[1px] z-20 px-1.5 py-0.5 flex items-center gap-1.5 text-xs text-white select-none pointer-events-none bg-black/40 rounded-lg">
                        {/* Speed indicator */}
                        <span className="font-medium opacity-80">
                            {(() => {
                                const speed = win.speed || 1.0;
                                const formatted = speed.toFixed(2).replace(/\.?0+$/, '');
                                return `${formatted}x`;
                            })()}
                        </span>

                        {/* Duration - hide if window too small */}
                        {width >= 70 && <span className="opacity-80">{(outputDurationMs / 1000).toFixed(1)}s</span>}
                    </div>
                )}
            </div>

            {/* Left resize handle */}
            <div
                className={resizeHandle.base}
                style={{
                    left: -resizeHandle.width / 2,
                    width: resizeHandle.width,
                    top: -1,
                    bottom: -1,
                }}
                onMouseDown={(e) => handleDragStart(e, seg.id, 'left')}
            >
                <div
                    className={`${dragHandleIndicator.base} ${dragHandleIndicator.leftClass} ${isSelected ? dragHandleIndicator.selectedClass : dragHandleIndicator.defaultClass}`}
                    style={{ height: 'calc(100% - 2px)' }}
                />
            </div>

            {/* Right resize handle */}
            <div
                className={resizeHandle.base}
                style={{
                    right: -resizeHandle.width / 2,
                    width: resizeHandle.width,
                    top: -1,
                    bottom: -1,
                }}
                onMouseDown={(e) => handleDragStart(e, seg.id, 'right')}
            >
                <div
                    className={`${dragHandleIndicator.base} ${dragHandleIndicator.rightClass} ${isSelected ? dragHandleIndicator.selectedClass : dragHandleIndicator.defaultClass}`}
                    style={{ height: 'calc(100% - 2px)' }}
                />
            </div>

            {/* Gap Bubble (Portal) */}
            {dragState && dragState.windowId === seg.id && (() => {
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

                const isPendingMerge = dragState.pendingMerge;
                const bubbleBg = 'bg-secondary';
                const bubbleBorderColor = 'border-border';
                const notchColor = 'before:border-b-border after:border-b-secondary';

                return createPortal(
                    <div
                        className="fixed z-[9999] pointer-events-none"
                        style={{
                            top: `${indicatorY}px`,
                            left: `${indicatorX}px`,
                            transform: 'translate(-50%, 8px)'
                        }}
                    >
                        <div className={`relative rounded-lg ${bubbleBg} text-text-on-secondary text-[10px] font-sans px-1.5 py-0.5 rounded shadow-xl border ${bubbleBorderColor} whitespace-nowrap transition-colors before:content-[''] before:absolute before:top-0 before:left-1/2 before:-translate-x-1/2 before:-translate-y-full before:border-[8px] before:border-transparent ${notchColor} before:z-10 after:absolute after:top-0 after:left-1/2 after:-translate-x-1/2 after:-translate-y-[calc(100%-1px)] after:border-[8px] after:border-transparent after:z-20`}>
                            {isPendingMerge ? 'Merge' : `${(remainingGapMs / 1000).toFixed(1)}s`}
                        </div>
                    </div>,
                    document.body
                );
            })()}
        </div>
    );
};
