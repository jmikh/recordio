import { useState } from 'react';
import { ExportManager } from '../../export/ExportManager';
import type { ExportQuality } from '../../export/ExportManager';
import { useProjectStore } from '../../stores/useProjectStore';

export const ExportButton = () => {
    const project = useProjectStore(s => s.project);
    const sources = useProjectStore(s => s.sources);
    const setExportState = useProjectStore(s => s.setExportState);
    const isExporting = useProjectStore(s => s.exportState.isExporting);

    const [isOpen, setIsOpen] = useState(false);

    const handleExport = async (quality: ExportQuality) => {
        setIsOpen(false);
        if (isExporting) return;

        setExportState({ isExporting: true, progress: 0, timeRemainingSeconds: null });

        const manager = new ExportManager();
        // Save manager reference in window or store if we want to cancel? 
        // For now, let's just keep it local callback-based or simple.
        // To implement cancellation, we need to pass the abort signal or manager instance elsewhere?
        // The Plan says: "Button: Cancel (triggers abort)".
        // So we need to store the active manager instance in a globally accessible place or the store?
        // If we put it in the store, we can call .cancel() on it. 
        // But ExportManager is a class instance. Zustand stores pure state mostly.
        // We can store it in a ref in the Modal? 
        // If the Modal is mounted *during* export, it can instantiate the manager?
        // Or better: ExportManager is a singleton or we use a `useRef` in a unified Controller?

        // Let's attach the manager to the window for now for simplicity of "Global Cancellation" or 
        // extend the store to hold "currentExportManager".

        // BETTER: define `currentExportManager` in module scope of ExportButton or App?
        // Actually, let's put it on the Window or module scope in ExportManager.ts?
        // No, multiple exports? Unlikely.

        // Strategy: We will stick the export logic inside a useEffect in the Modal? 
        // Or just let this button trigger it and we rely on the modal to show status.
        // The Cancellation button is solely in the Modal.
        // So the Modal needs access to the Manager.

        // Let's make `window.__currentExportManager`?
        // Or: `useProjectStore` can hold `cancelExport: () => void`. 

        // Updated Plan:
        // - ExportButton just sets `isExporting = true` and `exportQuality = '...'`.
        // - The Modal (or a wrapper) sees `isExporting`, instantiates ExportManager, runs it, and handles Cancel.

        // OK, I'll update store to hold `exportQuality`.

        // For now, let's just do the export HERE and pass a cancel function to the store?

        const onProgress = (state: any) => setExportState(state);

        try {
            // Assign to global for cancellation (hacky but effective for single active export)
            (window as any).__activeExportManager = manager;

            await manager.exportProject(project, sources, quality, onProgress);
        } catch (e) {
            console.error(e);
        } finally {
            setExportState({ isExporting: false });
            (window as any).__activeExportManager = null;
        }
    };

    return (
        <div className="relative">
            <button
                className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-fg text-xs font-medium rounded flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setIsOpen(!isOpen)}
                disabled={isExporting}
            >
                <span>Export</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transform transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 w-32 bg-surface-elevated border border-border rounded shadow-xl z-50 py-1">
                        {(['360p', '720p', '1080p', '4K'] as ExportQuality[]).map(q => (
                            <button
                                key={q}
                                className="w-full text-left px-4 py-2 text-xs text-text-muted hover:bg-surface hover:text-text-main transition-colors"
                                onClick={() => handleExport(q)}
                            >
                                {q}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};
