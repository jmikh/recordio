import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Modal, Button, Notice } from '@shared/components';
import { useProjectStore } from '../../stores/useProjectStore';
import { useTimeMapper } from '../../hooks/useTimeMapper';
import { useUIStore } from '../../stores/useUIStore';

export const FaceAnchorModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
}> = ({ isOpen, onClose }) => {
    const project = useProjectStore(s => s.project);
    const currentTimeMs = useUIStore(s => s.currentTimeMs);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const timeMapper = useTimeMapper();
    
    const cameraSettings = project.settings.camera;
    const cameraSource = project.cameraSource;

    const [localCenter, setLocalCenter] = useState<{x: number, y: number}>({ x: 0.5, y: 0.5 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStartOffset, setDragStartOffset] = useState<{x: number, y: number} | null>(null);
    
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (isOpen && cameraSettings) {
            setLocalCenter(cameraSettings.faceCenter || { x: 0.5, y: 0.5 });
        }
    }, [isOpen, cameraSettings]);

    // Sync video time
    useEffect(() => {
        if (isOpen && videoRef.current && cameraSource) {
            const sourceTimeMs = timeMapper.mapOutputToSourceTime(currentTimeMs);
            if (sourceTimeMs >= 0) {
                videoRef.current.currentTime = sourceTimeMs / 1000;
            }
        }
    }, [isOpen, currentTimeMs, timeMapper, cameraSource]);

    const handlePointerDownCenter = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (!containerRef.current || !cameraSource?.size) return;
        const rect = containerRef.current.getBoundingClientRect();
        
        const containerRatio = rect.width / rect.height;
        const videoRatio = cameraSource.size.width / cameraSource.size.height;
        let videoWidth = rect.width;
        let videoHeight = rect.height;
        let videoX = 0;
        let videoY = 0;

        if (containerRatio > videoRatio) {
            videoWidth = rect.height * videoRatio;
            videoX = (rect.width - videoWidth) / 2;
        } else {
            videoHeight = rect.width / videoRatio;
            videoY = (rect.height - videoHeight) / 2;
        }

        const px = e.clientX - rect.left - videoX;
        const py = e.clientY - rect.top - videoY;

        const startNx = px / videoWidth;
        const startNy = py / videoHeight;

        setDragStartOffset({
            x: startNx - localCenter.x,
            y: startNy - localCenter.y
        });

        setIsDragging(true);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return;
        if (!containerRef.current || !cameraSource?.size) return;

        const rect = containerRef.current.getBoundingClientRect();
        
        // Calculate the actual video display area within the object-contain container
        const containerRatio = rect.width / rect.height;
        const videoRatio = cameraSource.size.width / cameraSource.size.height;
        
        let videoWidth = rect.width;
        let videoHeight = rect.height;
        let videoX = 0;
        let videoY = 0;

        if (containerRatio > videoRatio) {
            videoWidth = rect.height * videoRatio;
            videoX = (rect.width - videoWidth) / 2;
        } else {
            videoHeight = rect.width / videoRatio;
            videoY = (rect.height - videoHeight) / 2;
        }

        // Pointer position relative to video
        const px = e.clientX - rect.left - videoX;
        const py = e.clientY - rect.top - videoY;

        // Normalized pointer position
        let nx = px / videoWidth;
        let ny = py / videoHeight;

        if (isDragging && dragStartOffset) {
            let targetX = nx - dragStartOffset.x;
            let targetY = ny - dragStartOffset.y;
            // Clamp center
            targetX = Math.max(0, Math.min(targetX, 1));
            targetY = Math.max(0, Math.min(targetY, 1));
            setLocalCenter({ x: targetX, y: targetY });
        }
    }, [isDragging, dragStartOffset, cameraSource]);

    const handlePointerUp = (e: React.PointerEvent) => {
        setIsDragging(false);
        setDragStartOffset(null);
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    };

    const handleSave = () => {
        if (cameraSettings) {
            updateSettings({
                camera: {
                    ...cameraSettings,
                    faceCenter: localCenter
                }
            });
        }
        onClose();
    };

    if (!cameraSettings || !cameraSource) {
        return null;
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[800px]">
            <div className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold border-b border-border pb-2">Center Face</h2>
                <p className="text-sm text-text-muted">
                    Drag the circle to center your face. We use this anchor to keep your face centered when you adjust size or crop zoom.
                </p>

                <div 
                    className="relative w-full bg-black rounded-lg overflow-hidden flex items-center justify-center select-none touch-none"
                    style={{ aspectRatio: `${cameraSource.size.width} / ${cameraSource.size.height}`, maxHeight: '60vh' }}
                    ref={containerRef}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                >
                    {cameraSource.runtimeUrl && (
                        <video 
                            ref={videoRef}
                            src={cameraSource.runtimeUrl}
                            className="w-full h-full object-contain pointer-events-none"
                            muted
                            playsInline
                        />
                    )}

                    {/* Draggable Face Circle Tracker */}
                    <div 
                        className="absolute rounded-full border-2 border-primary shadow-lg"
                        style={{
                            left: `${localCenter.x * 100}%`,
                            top: `${localCenter.y * 100}%`,
                            width: '30%', // Fixed visual representation size
                            // to make it a perfect circle visually, we need aspect-ratio 1:1, and height auto
                            aspectRatio: '1',
                            transform: 'translate(-50%, -50%)',
                            backgroundColor: 'rgba(123, 97, 255, 0.2)',
                            backdropFilter: 'brightness(1.1)',
                            cursor: isDragging ? 'grabbing' : 'grab'
                        }}
                        onPointerDown={handlePointerDownCenter}
                    >
                        {/* Center Dot */}
                        <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-primary rounded-full transform -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow" />
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button variant="primary" onClick={handleSave}>Save Anchor</Button>
                </div>
            </div>
        </Modal>
    );
};
