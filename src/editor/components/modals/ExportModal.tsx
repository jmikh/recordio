import { useProjectStore } from '../../stores/useProjectStore';
import { formatTimeCode } from '../../utils';

export const ExportModal = () => {
    const { isExporting, progress, timeRemainingSeconds } = useProjectStore(s => s.exportState);
    const projectName = useProjectStore(s => s.project.name);

    if (!isExporting) return null;

    const handleCancel = () => {
        const manager = (window as any).__activeExportManager;
        if (manager) {
            manager.cancel();
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-[#1e1e1e] border border-[#333] rounded-lg shadow-2xl p-6 max-w-md w-full flex flex-col gap-4">

                <div className="flex items-center justify-between">
                    <h2 className="text-white font-semibold text-lg">Exporting Project</h2>
                    <div className="spinner w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>

                <p className="text-gray-400 text-sm opacity-80 truncate">
                    {projectName}
                </p>

                <div className="flex flex-col gap-2">
                    <div className="h-2 bg-[#333] rounded-full overflow-hidden">
                        <div
                            className="h-full bg-blue-600 transition-all duration-300 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>{Math.round(progress * 100)}%</span>
                        <span>
                            {timeRemainingSeconds !== null
                                ? `~${formatTimeCode(timeRemainingSeconds * 1000)} remaining`
                                : 'Estimating time...'}
                        </span>
                    </div>
                </div>

                <div className="flex justify-end pt-2">
                    <button
                        onClick={handleCancel}
                        className="px-4 py-2 bg-[#333] hover:bg-[#444] text-white text-sm rounded transition-colors"
                    >
                        Cancel
                    </button>
                </div>

            </div>
        </div>
    );
};
