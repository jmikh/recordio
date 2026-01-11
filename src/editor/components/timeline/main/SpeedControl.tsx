import React, { useState, useRef, useEffect } from 'react';
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

const SPEED_MIN = 0.5;
const SPEED_MAX = 2.5;
const SPEED_STEP = 0.25;

export const SpeedControl: React.FC<SpeedControlProps> = ({
    windowId,
    currentSpeed,
    anchorEl,
    onClose
}) => {
    const [speed, setSpeed] = useState(currentSpeed);
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();
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

    const handleSpeedChange = (newSpeed: number) => {
        const clampedSpeed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, newSpeed));
        setSpeed(clampedSpeed);
        batchAction(() => {
            updateOutputWindow(windowId, { speed: clampedSpeed });
        });
    };

    const handleSliderStart = () => {
        startInteraction();
    };

    const handleSliderEnd = () => {
        endInteraction();
    };

    if (!anchorEl) return null;

    const rect = anchorEl.getBoundingClientRect();

    return createPortal(
        <div
            ref={popoverRef}
            className="fixed z-[9999] bg-surface-elevated border border-border rounded-lg shadow-xl p-3"
            style={{
                top: `${rect.bottom + 8}px`,
                left: `${rect.left}px`,
                minWidth: '200px'
            }}
        >
            {/* Header */}
            <div className="text-xs font-medium text-text-main mb-2">
                Playback Speed
            </div>

            {/* Speed Display */}
            <div className="text-center text-lg font-mono font-bold text-primary mb-3">
                {speed.toFixed(2)}x
            </div>

            {/* Slider */}
            <input
                type="range"
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={SPEED_STEP}
                value={speed}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                onMouseDown={handleSliderStart}
                onMouseUp={handleSliderEnd}
                className="w-full mb-3"
            />

            {/* Preset Buttons */}
            <div className="flex gap-1 justify-between">
                {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5].map(presetSpeed => (
                    <button
                        key={presetSpeed}
                        onClick={() => {
                            startInteraction();
                            handleSpeedChange(presetSpeed);
                            endInteraction();
                        }}
                        className={`px-2 py-1 text-xs rounded transition-colors ${Math.abs(speed - presetSpeed) < 0.01
                                ? 'bg-primary text-primary-fg'
                                : 'bg-surface hover:bg-surface-hover text-text-muted'
                            }`}
                    >
                        {presetSpeed}x
                    </button>
                ))}
            </div>
        </div>,
        document.body
    );
};
