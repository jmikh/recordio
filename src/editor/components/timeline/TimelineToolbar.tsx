import React from 'react';


interface TimelineToolbarProps {
    onSplit: () => void;
    isPlaying: boolean;
    onTogglePlay: () => void;
    pixelsPerSec: number;
    onScaleChange: (scale: number) => void;
    currentTimeMs: number;
    totalDurationMs: number;
}

const MIN_PIXELS_PER_SEC = 10;
const MAX_PIXELS_PER_SEC = 200;

export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
    onSplit,
    isPlaying,
    onTogglePlay,
    pixelsPerSec,
    onScaleChange,
    currentTimeMs,
    totalDurationMs,
}) => {
    // Helper format
    const formatFullTime = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        const dec = Math.floor((ms % 1000) / 100);
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${dec}`;
    };

    return (
        <div className="h-10 flex items-center px-4 bg-[#252526] border-b border-[#333] shrink-0 justify-between">
            <div className="flex items-center gap-2">
                <button
                    onClick={onSplit}
                    className="px-3 py-1 bg-[#333] hover:bg-[#444] rounded text-xs border border-[#555]"
                    title="Split at Playhead"
                >
                    Split
                </button>
            </div>

            <div className="flex items-center gap-4 bg-[#111] px-4 py-1 rounded-full border border-[#333]">
                <button onClick={onTogglePlay} className="hover:text-green-400">
                    {isPlaying ? '⏸' : '▶️'}
                </button>
                <div className="font-mono text-xs text-gray-400 w-32 text-center">
                    {formatFullTime(Math.max(0, currentTimeMs))} / {formatFullTime(totalDurationMs)}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">Scale</span>
                <input
                    type="range"
                    min={MIN_PIXELS_PER_SEC}
                    max={MAX_PIXELS_PER_SEC}
                    value={pixelsPerSec}
                    onChange={(e) => onScaleChange(Number(e.target.value))}
                    className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
            </div>
        </div>
    );
};
