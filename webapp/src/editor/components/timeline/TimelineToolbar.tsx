import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

import { MdPlayArrow, MdPause, MdAdd, MdRemove, MdDelete } from 'react-icons/md';
import { Slider, DefaultButton } from '@shared/components';


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
    // Stores
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);

    // Delete actions
    const removeOutputWindow = useProjectStore(s => s.removeOutputWindow);
    const deleteZoomAction = useProjectStore(s => s.deleteZoomAction);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);

    // Selection state
    const selectedWindowId = useUIStore(s => s.selectedWindowId);
    const selectedZoomId = useUIStore(s => s.selectedZoomId);
    const selectedSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);

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



    const onTogglePlay = () => setIsPlaying(!isPlaying);

    // Delete button logic
    const handleDelete = () => {
        // Can only delete window if it's NOT the last one
        if (selectedZoomId) {
            deleteZoomAction(selectedZoomId);
            setCanvasMode(CanvasMode.Preview);
        } else if (selectedSpotlightId) {
            deleteSpotlight(selectedSpotlightId);
            setCanvasMode(CanvasMode.Preview);
        } else if (selectedWindowId && outputWindows.length > 1) {
            removeOutputWindow(selectedWindowId);
        }
    };

    const canDeleteWindow = selectedWindowId && outputWindows.length > 1;
    const isDeleteEnabled = canDeleteWindow || Boolean(selectedZoomId) || Boolean(selectedSpotlightId);

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


    return (
        <div className="h-10 flex items-center px-4 bg-surface-default border-b border-border shrink-0 justify-between">
            <div className="flex items-center gap-2">
                {/* Delete Button */}
                <DefaultButton
                    onClick={handleDelete}
                    className="px-3 py-1 text-xs flex items-center gap-1"
                    title={
                        selectedWindowId && outputWindows.length <= 1
                            ? "Cannot delete the last window"
                            : "Delete selected item"
                    }
                    disabled={!isDeleteEnabled}
                >
                    <MdDelete size={14} />
                    Delete
                </DefaultButton>
            </div>

            <div className="flex items-center gap-4 bg-state-inactive px-4 py-1 rounded-full border border-border">
                <button onClick={onTogglePlay} className="hover:text-primary transition-colors flex items-center justify-center p-0.5 text-text-highlighted">
                    {isPlaying ? <MdPause size={18} /> : <MdPlayArrow size={18} />}
                </button>
                <div
                    ref={timeDisplayRef}
                    className="font-mono text-xs text-text-main min-w-[100px] text-center"
                >
                    00:00.0 / {formatSmartTime(totalDurationMs, totalDurationMs)}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <DefaultButton
                    onClick={onFit}
                    className="px-2 py-0.5 text-[10px]"
                    title="Fit timeline to screen"
                >
                    Fit
                </DefaultButton>
                <button
                    onClick={() => handleScaleChange(Math.max(MIN_PIXELS_PER_SEC, pixelsPerSec - 10))}
                    className="hover:text-primary transition-colors text-text-main"
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
                    className="hover:text-primary transition-colors text-text-main"
                >
                    <MdAdd size={14} />
                </button>
            </div>
        </div>
    );
};
