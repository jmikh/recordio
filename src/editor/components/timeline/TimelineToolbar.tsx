import React from 'react';


interface TimelineToolbarProps {
    onSplit: () => void;
    isPlaying: boolean;
    onTogglePlay: () => void;
    pixelsPerSec: number;
    onScaleChange: (scale: number) => void;
    onScaleInteractionStart?: () => void;
    onScaleInteractionEnd?: () => void;
    currentTimeMs: number;
    totalDurationMs: number;
    currentResolution?: { width: number; height: number };
    onResolutionChange?: (width: number, height: number) => void;
}

const MIN_PIXELS_PER_SEC = 10;
const MAX_PIXELS_PER_SEC = 200;

export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
    onSplit,
    isPlaying,
    onTogglePlay,
    pixelsPerSec,
    onScaleChange,
    onScaleInteractionStart,
    onScaleInteractionEnd,
    currentTimeMs,
    totalDurationMs,
    currentResolution,
    onResolutionChange
}) => {
    // Helper format
    const formatFullTime = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        const dec = Math.floor((ms % 1000) / 100);
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${dec}`;
    };

    const [isRatioOpen, setIsRatioOpen] = React.useState(false);
    const ratioRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (ratioRef.current && !ratioRef.current.contains(event.target as Node)) {
                setIsRatioOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const resolutions = [
        { label: '1:1 (Square)', width: 1080, height: 1080 },
        { label: '4:3 (Classic)', width: 1440, height: 1080 },
        { label: '16:9 (Widescreen)', width: 1920, height: 1080 },
    ];

    const currentAspectLabel = (() => {
        if (!currentResolution) return 'Ratio';
        const { width, height } = currentResolution;
        if (width === 1080 && height === 1080) return '1:1';
        if (width === 1440 && height === 1080) return '4:3';
        if (width === 1920 && height === 1080) return '16:9';
        return 'Custom';
    })();

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

                {/* Aspect Ratio Drop Up */}
                <div className="relative" ref={ratioRef}>
                    <button
                        onClick={() => setIsRatioOpen(!isRatioOpen)}
                        className="px-3 py-1 bg-[#333] hover:bg-[#444] rounded text-xs border border-[#555] flex items-center gap-1 min-w-[60px] justify-center"
                        title="Change Aspect Ratio"
                    >
                        {currentAspectLabel}
                        <span className="text-[10px] opacity-70">▲</span>
                    </button>

                    {isRatioOpen && (
                        <div className="absolute bottom-full left-0 mb-1 w-40 bg-[#252526] border border-[#444] rounded shadow-xl overflow-hidden z-50 flex flex-col">
                            {resolutions.map((res) => (
                                <button
                                    key={res.label}
                                    className="px-3 py-2 text-left text-xs hover:bg-[#333] text-gray-200 border-b border-[#333] last:border-0"
                                    onClick={() => {
                                        onResolutionChange?.(res.width, res.height);
                                        setIsRatioOpen(false);
                                    }}
                                >
                                    {res.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
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
                    onMouseDown={onScaleInteractionStart}
                    onMouseUp={onScaleInteractionEnd}
                    className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
            </div>
        </div>
    );
};
