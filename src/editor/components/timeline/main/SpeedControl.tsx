import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '../../../stores/useProjectStore';
import { useHistoryBatcher } from '../../../hooks/useHistoryBatcher';
import type { ID } from '../../../../core/types';

interface SpeedControlProps {
    windowId: ID;
    currentSpeed: number;
    anchorEl: HTMLElement | null;
    onClose: () => void;
}

export const SpeedControl: React.FC<SpeedControlProps> = ({
    windowId,
    currentSpeed,
    anchorEl,
    onClose
}) => {
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const { batchAction } = useHistoryBatcher();
    const popoverRef = useRef<HTMLDivElement>(null);

    // Handle click outside to close
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        // Use mousedown on document to catch clicks outside
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    const handleSpeedSelect = (newSpeed: number) => {
        batchAction(() => {
            updateOutputWindow(windowId, { speed: newSpeed });
        });
        onClose();
    };

    if (!anchorEl) return null;

    const rect = anchorEl.getBoundingClientRect();
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5];

    return createPortal(
        <div
            ref={popoverRef}
            className="fixed z-[9999] bg-surface-elevated border border-border rounded shadow-xl py-1 flex flex-col min-w-[120px]"
            style={{
                // Position above the anchor
                bottom: `${window.innerHeight - rect.top + 8}px`,
                left: `${rect.left}px`,
            }}
        >
            {speeds.map(presetSpeed => (
                <button
                    key={presetSpeed}
                    onClick={() => handleSpeedSelect(presetSpeed)}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors flex items-center justify-between ${Math.abs(currentSpeed - presetSpeed) < 0.01
                        ? 'bg-primary/10 text-primary'
                        : 'text-text-muted hover:bg-surface hover:text-text-main'
                        }`}
                >
                    <span>{presetSpeed}x</span>
                    {Math.abs(currentSpeed - presetSpeed) < 0.01 && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    )}
                </button>
            ))}
        </div>,
        document.body
    );
};
