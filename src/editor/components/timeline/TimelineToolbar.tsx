import React from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { TimeMapper } from '../../../core/timeMapper';
import { MdPlayArrow, MdPause } from 'react-icons/md';


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
    //console.log('[Rerender] TimelineToolbar');
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
        const timeMapper = new TimeMapper(timeline.outputWindows);

        const result = timeMapper.getWindowAtOutputTime(currentTime);
        if (!result) return;

        const { window: win, outputStartMs } = result;
        const offset = currentTime - outputStartMs;
        const splitTime = win.startMs + offset;

        splitWindow(win.id, splitTime);
    };

    const handleScaleChange = (newScale: number) => {
        setPixelsPerSec(newScale);
    };

    const handleResolutionChange = (width: number, height: number) => {
        updateSettings({ outputSize: { width, height } });
    };

    const onTogglePlay = () => setIsPlaying(!isPlaying);

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
                timeDisplayRef.current.textContent = `${formatSmartTime(Math.max(0, time), totalDurationMs)} / ${formatSmartTime(totalDurationMs, totalDurationMs)}`;
            }
        };

        // Initial set
        updateTimeDisplay();

        const unsub = useUIStore.subscribe((state) => {
            // Only update if playing or time changed significantly? No, just update.
            // But we can check if string changed to avoid DOM touch if needed. 
            // DOM textContent set is cheap enough.
            if (timeDisplayRef.current) {
                timeDisplayRef.current.textContent = `${formatSmartTime(Math.max(0, state.currentTimeMs), totalDurationMs)} / ${formatSmartTime(totalDurationMs, totalDurationMs)}`;
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
        <div className="h-10 flex items-center px-4 bg-surface-elevated border-b border-border shrink-0 justify-between">
            <div className="flex items-center gap-2">
                <button
                    onClick={handleSplit}
                    className="px-3 py-1 bg-surface hover:bg-surface-elevated rounded text-xs border border-border"
                    title="Split at Playhead"
                >
                    Split
                </button>

                {/* Aspect Ratio Drop Up */}
                <div className="relative" ref={ratioRef}>
                    <button
                        onClick={() => setIsRatioOpen(!isRatioOpen)}
                        className="px-3 py-1 bg-surface hover:bg-surface-elevated rounded text-xs border border-border flex items-center gap-1 min-w-[60px] justify-center"
                        title="Change Aspect Ratio"
                    >
                        {currentAspectLabel}
                        <span className="text-[10px] opacity-70">▲</span>
                    </button>

                    {isRatioOpen && (
                        <div className="absolute bottom-full left-0 mb-1 w-40 bg-surface-elevated border border-border rounded shadow-xl overflow-hidden z-50 flex flex-col">
                            {resolutions.map((res) => (
                                <button
                                    key={res.label}
                                    className="px-3 py-2 text-left text-xs hover:bg-surface text-text-main border-b border-border last:border-0"
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

            <div className="flex items-center gap-4 bg-background px-4 py-1 rounded-full border border-border">
                <button onClick={onTogglePlay} className="hover:text-primary transition-colors flex items-center justify-center p-0.5 text-text-main">
                    {isPlaying ? <MdPause size={18} /> : <MdPlayArrow size={18} />}
                </button>
                <div
                    ref={timeDisplayRef}
                    className="font-mono text-xs text-text-muted min-w-[100px] text-center"
                >
                    00:00.0 / {formatSmartTime(totalDurationMs, totalDurationMs)}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={onFit}
                    className="px-2 py-0.5 bg-surface hover:bg-surface-elevated rounded text-[10px] border border-border"
                    title="Fit timeline to screen"
                >
                    Fit
                </button>
                <div className="w-[1px] h-4 bg-border mx-1" />
                <span className="text-[10px] text-text-muted">Scale</span>
                <input
                    type="range"
                    min={MIN_PIXELS_PER_SEC}
                    max={MAX_PIXELS_PER_SEC}
                    value={pixelsPerSec}
                    onChange={(e) => handleScaleChange(Number(e.target.value))}
                    onMouseDown={batcher.startInteraction}
                    onMouseUp={batcher.endInteraction}
                    className="w-24 h-1 bg-surface rounded-lg appearance-none cursor-pointer"
                />
            </div>
        </div>
    );
};
