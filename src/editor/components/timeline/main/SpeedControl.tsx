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

const SPEED_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5];

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

    return createPortal(
        <div
            ref={popoverRef}
            className="fixed z-[9999] bg-surface-overlay border border-border rounded shadow-xl p-1 flex flex-col min-w-[120px]"
            style={{
                bottom: `${window.innerHeight - rect.top + 8}px`,
                left: `${rect.left}px`,
            }}
        >
            {SPEED_PRESETS.map(presetSpeed => {
                const isSelected = Math.abs(currentSpeed - presetSpeed) < 0.01;

                return (
                    <button
                        key={presetSpeed}
                        onClick={() => handleSpeedSelect(presetSpeed)}
                        className={`w-full text-left px-4 py-2 text-xs transition-colors flex items-center justify-between rounded-sm ${isSelected
                            ? 'bg-primary/20 text-primary'
                            : 'text-text-muted hover:bg-hover hover:text-text-main'
                            }`}
                    >
                        <span>{presetSpeed}x</span>
                        {isSelected && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        )}
                    </button>
                );
            })}
        </div>,
        document.body
    );
};

