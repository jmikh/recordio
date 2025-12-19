import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEffect } from '../../core/types';

interface TimelineTrackMouseEffectsProps {
    effects: MouseEffect[];
    pixelsPerSec: number;
}

export const TimelineTrackMouseEffects: React.FC<TimelineTrackMouseEffectsProps> = ({ effects, pixelsPerSec }) => {
    // Height of the track
    const TRACK_HEIGHT = 16;

    return (
        <div className="relative w-full mt-1" style={{ height: TRACK_HEIGHT }}>
            {effects.map((effect) => {
                const durationMs = effect.timeOutMs - effect.timeInMs;
                const left = (effect.timeInMs / 1000) * pixelsPerSec;
                const width = Math.max((durationMs / 1000) * pixelsPerSec, 4); // Ensure min width

                return (
                    <EffectBlock
                        key={effect.id}
                        effect={effect}
                        left={left}
                        width={width}
                    />
                );
            })}
        </div>
    );
};

interface EffectBlockProps {
    effect: MouseEffect;
    left: number;
    width: number;
}

const EffectBlock: React.FC<EffectBlockProps> = ({ effect, left, width }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [coords, setCoords] = useState<{ x: number, y: number } | null>(null);

    const handleMouseEnter = (e: React.MouseEvent) => {
        setIsHovered(true);
        const rect = e.currentTarget.getBoundingClientRect();
        setCoords({
            x: rect.left + rect.width / 2,
            y: rect.top
        });
    };

    const isClick = effect.type === 'click';
    const bgColor = isClick ? 'bg-orange-500' : 'bg-blue-500';
    const borderColor = isClick ? 'border-orange-400' : 'border-blue-400';
    const label = isClick ? 'Left Click' : 'Drag';

    return (
        <>
            <div
                className={`absolute top-0 bottom-0 ${bgColor} ${borderColor} border rounded-sm cursor-pointer hover:brightness-110 opacity-80`}
                style={{ left: `${left}px`, width: `${width}px` }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={() => setIsHovered(false)}
            />

            {/* Tooltip Portal */}
            {isHovered && coords && createPortal(
                <div
                    className="fixed mb-2 p-2 bg-gray-900 border border-gray-700 rounded shadow-xl z-[9999] whitespace-nowrap text-xs text-white pointer-events-none"
                    style={{
                        left: coords.x,
                        top: coords.y,
                        transform: 'translate(-50%, -100%)'
                    }}
                >
                    <div className="font-bold mb-1 flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${bgColor}`}></span>
                        {label}
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-gray-300">
                        <span>Time:</span>
                        <span>{(effect.timeInMs / 1000).toFixed(2)}s</span>

                        <span>Duration:</span>
                        <span>{((effect.timeOutMs - effect.timeInMs) / 1000).toFixed(2)}s</span>

                        <span>Start:</span>
                        <span>{Math.round(effect.start.x)}, {Math.round(effect.start.y)}</span>

                        {!isClick && effect.end && (
                            <>
                                <span>End:</span>
                                <span>{Math.round(effect.end.x)}, {Math.round(effect.end.y)}</span>
                            </>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
};
