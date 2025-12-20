import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { CameraMotion } from '../../core/types';

interface TimelineTrackCameraMotionsProps {
    motions: CameraMotion[];
    pixelsPerSec: number;
}

export const TimelineTrackCameraMotions: React.FC<TimelineTrackCameraMotionsProps> = ({ motions, pixelsPerSec }) => {
    // Height of the motion track
    const TRACK_HEIGHT = 20;

    return (
        <div className="relative w-full" style={{ height: TRACK_HEIGHT }}>
            {motions.map((motion) => {
                // Calculate position and width
                const durationMs = motion.timeOutMs - motion.timeInMs;
                const left = (motion.timeInMs / 1000) * pixelsPerSec;
                const width = (durationMs / 1000) * pixelsPerSec;

                return (
                    <MotionBlock
                        key={motion.id}
                        motion={motion}
                        left={left}
                        width={width}
                    // Ensure min width for visibility if duration is very short? 
                    // But motions usually have duration. 
                    />
                );
            })}
        </div>
    );
};

interface MotionBlockProps {
    motion: CameraMotion;
    left: number;
    width: number;
}

const MotionBlock: React.FC<MotionBlockProps> = ({ motion, left, width }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [coords, setCoords] = useState<{ x: number, y: number } | null>(null);

    const handleMouseEnter = (e: React.MouseEvent) => {
        setIsHovered(true);
        const rect = e.currentTarget.getBoundingClientRect();
        // Position above the block centered
        setCoords({
            x: rect.left + rect.width / 2,
            y: rect.top
        });
    };

    return (
        <>
            <div
                className="absolute top-0 bottom-0 bg-purple-600/80 border border-purple-500/50 rounded-sm overflow-visible cursor-pointer hover:brightness-110"
                style={{ left: `${left}px`, width: `${Math.max(width, 2)}px` }}
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
                        transform: 'translate(-50%, -100%)' // Center horizontally and move up
                    }}
                >
                    <div className="font-bold mb-1">Camera Motion</div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-gray-300">
                        <span>Target:</span>
                        <span>{Math.round(motion.cameraWindow.x)}, {Math.round(motion.cameraWindow.y)} (w:{Math.round(motion.cameraWindow.width)})</span>

                        <span>Time:</span>
                        <span>{(motion.timeInMs / 1000).toFixed(1)}s - {(motion.timeOutMs / 1000).toFixed(1)}s</span>

                        <span>Duration:</span>
                        <span>{((motion.timeOutMs - motion.timeInMs) / 1000).toFixed(1)}s</span>

                        <span>Easing:</span>
                        <span>{motion.easing}</span>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
};
