import React from 'react';
import { useProjectStore, useProjectTimeline } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { getTimeMapper } from '../../hooks/useTimeMapper';
import { MdPlayArrow, MdPause, MdAdd, MdRemove } from 'react-icons/md';
import { Slider } from '../common/Slider';
import { Dropdown } from '../common/Dropdown';
import type { DropdownOption } from '../common/Dropdown';
import { Button } from '../common/Button';


interface TimelineToolbarProps {
    totalDurationMs: number;
    onFit: () => void;
}

export const MIN_PIXELS_PER_SEC = 10;
export const MAX_PIXELS_PER_SEC = 200;

interface Resolution {
    label: string;
    width: number;
    height: number;
}

const RESOLUTIONS: Resolution[] = [
    { label: '1:1', width: 1080 * 2, height: 1080 * 2 },
    { label: '4:3', width: 1440 * 2, height: 1080 * 2 },
    { label: '16:9', width: 1920 * 2, height: 1080 * 2 },
];

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
        const timeMapper = getTimeMapper(timeline.outputWindows);

        const result = timeMapper.getWindowAtOutputTime(currentTime);
        if (!result) return;

        const { window: win, outputStartMs } = result;
        const outputOffset = currentTime - outputStartMs;
        const speed = win.speed || 1.0;
        const sourceOffset = outputOffset * speed;  // Convert output time to source time
        const splitTime = win.startMs + sourceOffset;

        splitWindow(win.id, splitTime);
    };

    const handleScaleChange = (newScale: number) => {
        setPixelsPerSec(newScale);
    };

    const handleResolutionChange = (resolution: Resolution) => {
        updateSettings({ outputSize: { width: resolution.width, height: resolution.height } });
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

    // Get current aspect ratio and resolution
    const currentResolutionObj = RESOLUTIONS.find(
        r => r.width === currentResolution?.width && r.height === currentResolution?.height
    ) || RESOLUTIONS[2]; // Default to 16:9


    const resolutionOptions: DropdownOption<Resolution>[] = RESOLUTIONS.map(res => ({
        value: res,
        label: res.label,
    }));

    return (
        <div className="h-10 flex items-center px-4 bg-surface-elevated border-b border-border shrink-0 justify-between">
            <div className="flex items-center gap-2">
                <Button
                    onClick={handleSplit}
                    className="px-3 py-1 text-xs"
                    title="Split at Playhead"
                >
                    Split
                </Button>

                {/* Aspect Ratio Dropdown */}
                <Dropdown
                    options={resolutionOptions}
                    value={currentResolutionObj}
                    onChange={handleResolutionChange}
                    trigger={
                        <Button
                            className="px-3 py-1 text-xs flex items-center gap-1 min-w-[60px] justify-center"
                            title="Change Aspect Ratio"
                        >
                            {currentResolutionObj.label}
                            <span className="text-[10px] opacity-70">▲</span>
                        </Button>
                    }
                    direction="up"
                />
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
                <Button
                    onClick={onFit}
                    className="px-2 py-0.5 text-[10px]"
                    title="Fit timeline to screen"
                >
                    Fit
                </Button>
                <button
                    onClick={() => handleScaleChange(Math.max(MIN_PIXELS_PER_SEC, pixelsPerSec - 10))}
                    className="hover:text-primary transition-colors text-text-muted"
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
                        showTooltip
                    />
                </div>
                <button
                    onClick={() => handleScaleChange(Math.min(MAX_PIXELS_PER_SEC, pixelsPerSec + 10))}
                    className="hover:text-primary transition-colors text-text-muted"
                >
                    <MdAdd size={14} />
                </button>
            </div>
        </div>
    );
};
