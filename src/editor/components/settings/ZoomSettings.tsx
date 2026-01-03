
import React from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

export const ZoomSettings = () => {
    const updateSettings = useProjectStore(s => s.updateSettings);
    const updateRecording = useProjectStore(s => s.updateRecording);
    const zoomSettings = useProjectStore(s => s.project.settings.zoom);
    const { startInteraction, endInteraction, updateWithBatching } = useHistoryBatcher();

    const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val)) {
            updateWithBatching({ zoom: { ...zoomSettings, defaultDurationMs: val } });
        }
    };

    const handleAutoZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        updateSettings({ zoom: { autoZoom: e.target.checked } });
    };

    const handleClearZooms = () => {
        if (confirm("Are you sure you want to clear all zooms? This will also disable Auto Zoom.")) {
            // 1. Clear motions
            updateRecording({ viewportMotions: [] });
            // 2. Disable auto zoom to prevent recalc
            updateSettings({ zoom: { autoZoom: false } });
        }
    };

    return (
        <div className="flex flex-col gap-6 text-sm text-gray-300">
            {/* Transition Duration */}
            <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                    <label className="text-xs uppercase font-bold text-gray-500">Transition Duration</label>
                    <span className="text-xs font-mono text-blue-400">{zoomSettings.defaultDurationMs}ms</span>
                </div>
                <input
                    type="range"
                    min={250}
                    max={1500}
                    step={50}
                    value={zoomSettings.defaultDurationMs}
                    onChange={handleDurationChange}
                    onPointerDown={startInteraction}
                    onPointerUp={endInteraction}
                    className="w-full accent-blue-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-[10px] text-gray-500">
                    Speed of zoom animations.
                </p>
            </div>

            <div className="h-px bg-gray-800" />

            {/* Auto Zoom */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                    <label className="text-xs uppercase font-bold text-gray-500">Auto Zoom</label>
                    <p className="text-[10px] text-gray-500 max-w-[200px]">
                        Automatically create zooms based on mouse movement.
                    </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={zoomSettings.autoZoom}
                        onChange={handleAutoZoomChange}
                        className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
            </div>

            {/* Actions */}
            <div className="pt-2">
                <button
                    onClick={handleClearZooms}
                    className="w-full py-2 px-4 rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-medium transition-colors border border-red-500/20 flex items-center justify-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                    </svg>
                    Clear All Zooms
                </button>
            </div>
        </div>
    );
};
