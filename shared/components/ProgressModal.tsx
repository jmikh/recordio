import { Modal } from './Modal';

interface ProgressModalProps {
    isOpen: boolean;
    title: string;
    projectName: string;
    progress: number;
    statusText: string;
    onCancel: () => void;
}

export const ProgressModal = ({
    isOpen,
    title,
    projectName,
    progress,
    statusText,
    onCancel
}: ProgressModalProps) => {
    return (
        <Modal isOpen={isOpen} maxWidth="max-w-md">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-text-highlighted font-semibold text-lg">{title}</h2>
                    <div className="spinner w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>

                <p className="text-text-main text-sm opacity-80 truncate">
                    {projectName}
                </p>

                <div className="flex flex-col gap-2">
                    <div className="h-2 bg-surface rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between text-xs text-text-main">
                        <span>{Math.round(progress * 100)}%</span>
                        <span>{statusText}</span>
                    </div>
                </div>

                <div className="flex justify-end pt-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 bg-surface hover:bg-surface-hover text-text-highlighted text-sm rounded transition-colors border border-border"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </Modal>
    );
};
