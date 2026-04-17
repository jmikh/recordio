import { Modal } from './Modal';
import { HiOutlineBolt } from 'react-icons/hi2';
import logoSvg from '../assets/logo.svg';

interface ProgressModalProps {
    isOpen: boolean;
    title: string;
    projectName: string;
    progress: number;
    statusText: string;
    onCancel: () => void;
    decodeFallback?: boolean;
}

export const ProgressModal = ({
    isOpen,
    title,
    projectName,
    progress,
    statusText,
    onCancel,
    decodeFallback = false
}: ProgressModalProps) => {
    const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));

    return (
        <Modal isOpen={isOpen} maxWidth="max-w-md">
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <img src={logoSvg} alt="" className="w-7 h-7" />
                        <h2 className="text-text-highlighted font-semibold text-lg">{title}</h2>
                    </div>
                    <div className="spinner w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>

                <p className="text-text-main text-sm opacity-80 truncate">
                    {projectName}
                </p>

                <div className="flex flex-col gap-2">
                    <div className="h-2 bg-surface rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300 ease-out"
                            style={{ width: `${pct}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between text-xs text-text-main">
                        <span>{pct}%</span>
                        <span>{statusText}</span>
                    </div>

                    <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-surface rounded-lg border border-border text-xs text-text-main">
                        <span className="text-primary flex-shrink-0 flex items-center justify-center">
                            <HiOutlineBolt className="icon-lg" />
                        </span>
                        <span>Do not switch tab during export for best performance</span>
                    </div>
                    {decodeFallback && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-surface rounded-lg border border-border text-xs text-text-muted">
                            <span className="text-base flex-shrink-0">⚙️</span>
                            <span>GPU decoding unavailable — using CPU instead. Export may be slower.</span>
                        </div>
                    )}
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
