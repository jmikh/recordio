

import { useProjectStore } from '../../stores/useProjectStore';

export const ZoomSettings = () => {
    const updateSettings = useProjectStore(s => s.updateSettings);
    const zoomSettings = useProjectStore(s => s.project.settings.zoom);

    const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val >= 0) {
            updateSettings({ zoom: { defaultDurationMs: val } });
        }
    };

    return (
        <div className="flex flex-col gap-4 text-sm text-gray-300">
            <div className="flex flex-col gap-2">
                <label className="text-xs uppercase font-bold text-gray-500">Default Zoom Duration (ms)</label>
                <input
                    type="number"
                    value={zoomSettings.defaultDurationMs}
                    onChange={handleDurationChange}
                    className="bg-[#333] border border-[#444] rounded px-2 py-1 text-white focus:outline-none focus:border-blue-500"
                />
                <p className="text-xs text-gray-500">
                    Duration applied when creating new manual zooms.
                </p>
            </div>
        </div>
    );
};
