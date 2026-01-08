import React from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

interface TimelineToolbarProps {
    totalDurationMs: number;
}

const MIN_PIXELS_PER_SEC = 10;
const MAX_PIXELS_PER_SEC = 200;

export const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
    totalDurationMs,
}) => {
    console.log('[Rerender] TimelineToolbar');
    // Stores
    const timeline = useProjectTimeline();
    const splitWindow = useProjectStore(s => s.splitWindow);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const currentResolution = useProjectStore(s => s.project.settings.outputSize);

    // Subscribe for perf
    const timeDisplayRef = React.useRef<HTMLDivElement>(null);
    const isPlaying = useUIStore(s => s.isPlaying);
    const setIsPlaying = useUIStore(s => s.setIsPlaying);
    const pixelsPerSec = useUIStore(s => s.pixelsPerSec);
    const setPixelsPerSec = useUIStore(s => s.setPixelsPerSec);

    // History Batcher
    const batcher = useHistoryBatcher();

    // Handlers
    const handleSplit = () => {
        const currentTime = useUIStore.getState().currentTimeMs;
        const activeWinIndex = timeline.outputWindows.findIndex(w => currentTime > w.startMs && currentTime < w.endMs);
        if (activeWinIndex === -1) return;
        const win = timeline.outputWindows[activeWinIndex];
        splitWindow(win.id, currentTime);
    };

    const handleScaleChange = (newScale: number) => {
        setPixelsPerSec(newScale);
    };

    const handleResolutionChange = (width: number, height: number) => {
        updateSettings({ outputSize: { width, height } });
    };

    const onTogglePlay = () => setIsPlaying(!isPlaying);

    // Helper format
    const formatFullTime = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        const dec = Math.floor((ms % 1000) / 100);
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${dec}`;
    };

    // perf: Update time without re-render
    React.useEffect(() => {
        // Initial set
        if (timeDisplayRef.current) {
            const time = useUIStore.getState().currentTimeMs;
            timeDisplayRef.current.textContent = `${formatFullTime(Math.max(0, time))} / ${formatFullTime(totalDurationMs)}`;
        }

        const unsub = useUIStore.subscribe((state) => {
            if (timeDisplayRef.current) {
                timeDisplayRef.current.textContent = `${formatFullTime(Math.max(0, state.currentTimeMs))} / ${formatFullTime(totalDurationMs)}`;
            }
        });
        return unsub;
    }, [totalDurationMs]);

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
        { label: '1:1 (Square)', width: 1080 * 2, height: 1080 * 2 },
        { label: '4:3 (Classic)', width: 1440 * 2, height: 1080 * 2 },
        { label: '16:9 (Widescreen)', width: 1920 * 2, height: 1080 * 2 },
    ];

    const currentAspectLabel = (() => {
        if (!currentResolution) return 'Ratio';
        const { width, height } = currentResolution;
        if (width === 1080 * 2 && height === 1080 * 2) return '1:1';
        if (width === 1440 * 2 && height === 1080 * 2) return '4:3';
        if (width === 1920 * 2 && height === 1080 * 2) return '16:9';
        return 'Custom';
    })();

    return (
        <div className="h-10 flex items-center px-4 bg-[#252526] border-b border-[#333] shrink-0 justify-between">
            <div className="flex items-center gap-2">
                <button
                    onClick={handleSplit}
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
                                        handleResolutionChange(res.width, res.height);
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
                <div
                    ref={timeDisplayRef}
                    className="font-mono text-xs text-gray-400 w-32 text-center"
                >
                    00:00.0 / {formatFullTime(totalDurationMs)}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">Scale</span>
                <input
                    type="range"
                    min={MIN_PIXELS_PER_SEC}
                    max={MAX_PIXELS_PER_SEC}
                    value={pixelsPerSec}
                    onChange={(e) => handleScaleChange(Number(e.target.value))}
                    onMouseDown={batcher.startInteraction}
                    onMouseUp={batcher.endInteraction}
                    className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                />
            </div>
        </div>
    );
};
