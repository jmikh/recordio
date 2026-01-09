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
        <div className="fixed inset-0 z-[100] bg-background/80 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-surface-elevated border border-border rounded-lg shadow-2xl p-6 max-w-md w-full flex flex-col gap-4">

                <div className="flex items-center justify-between">
                    <h2 className="text-text-main font-semibold text-lg">Exporting Project</h2>
                    <div className="spinner w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>

                <p className="text-text-muted text-sm opacity-80 truncate">
                    {projectName}
                </p>

                <div className="flex flex-col gap-2">
                    <div className="h-2 bg-surface rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between text-xs text-text-muted">
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
                        className="px-4 py-2 bg-surface hover:bg-surface-hover text-text-main text-sm rounded transition-colors border border-border"
                    >
                        Cancel
                    </button>
                </div>

            </div>
        </div>
    );
};
