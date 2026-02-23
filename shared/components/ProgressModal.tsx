import { useEffect, useRef } from 'react';
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
    // Smoothly animate the displayed percentage toward the real value
    const displayRef = useRef(0);
    const rafRef = useRef<number>(0);
    const spanRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!isOpen) { displayRef.current = 0; return; }

        const target = Math.max(0, Math.min(100, progress * 100));
        let prev = performance.now();

        const tick = (now: number) => {
            const dt = Math.min(now - prev, 50); // cap to avoid big jumps after tab switch
            prev = now;
            // Lerp: close ~90% of the gap in 700ms  →  rate ≈ 3.3/s
            const speed = 3.3 * (dt / 1000);
            displayRef.current += (target - displayRef.current) * Math.min(speed, 1);
            // Snap when close enough
            if (Math.abs(target - displayRef.current) < 0.1) displayRef.current = target;
            if (spanRef.current) spanRef.current.textContent = `${Math.round(displayRef.current)}%`;
            if (displayRef.current !== target) {
                rafRef.current = requestAnimationFrame(tick);
            }
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [isOpen, progress]);

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
                            className="h-full bg-primary transition-all duration-700 ease-out"
                            style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between text-xs text-text-main">
                        <span ref={spanRef}>{Math.round(progress * 100)}%</span>
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
