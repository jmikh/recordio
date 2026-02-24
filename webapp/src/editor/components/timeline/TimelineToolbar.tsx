import React from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

import { useTimeMapper } from '../../hooks/useTimeMapper';
import { MdPlayArrow, MdPause, MdAdd, MdRemove } from 'react-icons/md';
import { Slider } from '@shared/components';


interface TimelineToolbarProps {
    totalDurationMs: number;
    onFit: () => void;
}

export const MIN_PIXELS_PER_SEC = 10;
export const MAX_PIXELS_PER_SEC = 200;



export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
    totalDurationMs,
    onFit,
}) => {
    // Subscribe for perf
    const timeDisplayRef = React.useRef<HTMLDivElement>(null);
    const isPlaying = useUIStore(s => s.isPlaying);
    const setIsPlaying = useUIStore(s => s.setIsPlaying);
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const setPixelsPerSec = useUIStore(s => s.setPixelsPerSec);

    // History Batcher
    const batcher = useHistoryBatcher();

    // Handlers

    const handleScaleChange = (newScale: number) => {
        setPixelsPerSec(newScale);
    };


    const timeMapper = useTimeMapper();
    const onTogglePlay = () => {
        if (!isPlaying && useUIStore.getState().currentTimeMs >= timeMapper.outputDuration) {
            useUIStore.getState().setCurrentTime(0);
        }
        setIsPlaying(!isPlaying);
    };



    // Helper format
    const formatSmartTime = (ms: number, totalMs: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const deciseconds = Math.floor((ms % 1000) / 100);

        const hasHours = totalMs >= 3600000;

        if (hasHours) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${deciseconds}`;
        } else {
            return `${minutes}:${seconds.toString().padStart(2, '0')}.${deciseconds}`;
        }
    };

    // perf: Update time without re-render
    React.useEffect(() => {
        const updateTimeDisplay = () => {
            if (timeDisplayRef.current) {
                const time = useUIStore.getState().currentTimeMs;
                timeDisplayRef.current.textContent = formatSmartTime(Math.max(0, time), totalDurationMs);
            }
        };

        // Initial set
        updateTimeDisplay();

        const unsub = useUIStore.subscribe((state) => {
            if (timeDisplayRef.current) {
                timeDisplayRef.current.textContent = formatSmartTime(Math.max(0, state.currentTimeMs), totalDurationMs);
            }
        });
        return unsub;
    }, [totalDurationMs]);


    return (
        <div className="h-10 flex items-center px-4 p-4 bg-surface  border-b border-border-selected shrink-0 justify-between">
            <div className="flex items-center gap-2">
            </div>

            <div className="flex items-center gap-3">
                <button
                    onClick={onTogglePlay}
                    className="w-7 h-7 rounded-full bg-primary text-text-on-primary hover:bg-primary-highlighted transition-colors flex items-center justify-center shrink-0"
                >
                    {isPlaying ? <MdPause size={18} /> : <MdPlayArrow size={18} />}
                </button>
                <div className="flex items-baseline gap-1.5">
                    <div
                        ref={timeDisplayRef}
                        className="text-sm text-text-main tabular-nums"
                    >
                        00:00.0
                    </div>
                    <span className="text-xs text-text-muted">/</span>
                    <div className="text-xs text-text-muted tabular-nums">
                        {formatSmartTime(totalDurationMs, totalDurationMs)}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={onFit}
                    className="interactive-ghost flex items-center justify-center gap-2 px-2 py-0.5 text-[10px]"
                    title="Fit timeline to screen"
                >
                    Fit
                </button>
                <button
                    onClick={() => handleScaleChange(Math.max(MIN_PIXELS_PER_SEC, pixelsPerSec - 10))}
                    className="interactive-ghost flex items-center justify-center gap-2 px-1"
                >
                    <MdRemove size={14} />
                </button>
                <div className="w-24">
                    <Slider
                        value={pixelsPerSec}
                        onChange={handleScaleChange}
                        min={MIN_PIXELS_PER_SEC}
                        max={MAX_PIXELS_PER_SEC}
                        onPointerDown={batcher.startInteraction}
                        onPointerUp={batcher.endInteraction}
                    />
                </div>
                <button
                    onClick={() => handleScaleChange(Math.min(MAX_PIXELS_PER_SEC, pixelsPerSec + 10))}
                    className="interactive-ghost flex items-center justify-center gap-2 px-1"
                >
                    <MdAdd size={14} />
                </button>
            </div>
        </div>
    );
};
