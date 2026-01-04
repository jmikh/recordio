import React, { useEffect, useRef } from 'react';

interface CameraPreviewProps {
    stream: MediaStream | null;
}

export const CameraPreview: React.FC<CameraPreviewProps> = ({ stream }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    if (!stream) return null;

    return (
        <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border border-slate-700 shadow-inner mt-2">
            <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover transform -scale-x-100" // Mirror effect
            />
        </div>
    );
};
