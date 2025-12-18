import { useState, useEffect, useRef } from 'react';
import { PlayerCanvas } from './PlayerCanvas';
import { logger } from '../utils/logger';
import { useEditorStore, type Metadata } from './store';
import { Timeline } from './Timeline';
import { EventInspector } from './EventInspector';
import { ZoomInspector } from './ZoomInspector';
import { virtualToSourceTime } from './utils';
import { type ZoomEvent } from '../lib/zoom';
import { useZoomSchedule } from './useZoomSchedule';




function Editor() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [containerSize, setContainerSize] = useState({ width: 800, height: 450 });
    const schedule = useZoomSchedule();

    const onVideoLoaded = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const w = e.currentTarget.videoWidth;
        const h = e.currentTarget.videoHeight;
        setInputVideoSize({ width: w, height: h });
    };

    // Store State
    const {
        videoUrl,
        metadata,

        segments,
        currentTime,
        isPlaying,
        setVideoUrl,
        setMetadata,
        setRecordingStartTime,
        initSegments,
        setCurrentTime,
        setIsPlaying,
        // paddingPercentage, // Removed unused
        outputVideoSize,
        inputVideoSize,
        setInputVideoSize
    } = useEditorStore();

    // Data Loading
    useEffect(() => {
        chrome.storage.local.get(['recordingMetadata'], (result) => {
            if (result.recordingMetadata) {
                setMetadata(result.recordingMetadata as Metadata[]);
            }
        });

        const request = indexedDB.open('RecordoDB', 1);
        request.onsuccess = (event: any) => {
            const db = event.target.result;
            const transaction = db.transaction(['recordings'], 'readonly');
            const store = transaction.objectStore('recordings');
            const getRequest = store.get('latest');
            getRequest.onsuccess = () => {
                const result = getRequest.result;
                if (result) {
                    const blob = result.blob;
                    setVideoUrl(URL.createObjectURL(blob));
                    if (result.startTime) setRecordingStartTime(result.startTime);
                    else if (result.timestamp) setRecordingStartTime(result.timestamp);

                    if (result.width && result.height) {
                        setInputVideoSize({ width: result.width, height: result.height });
                    }

                    if (result.duration && result.duration > 0 && result.duration !== Infinity) {
                        initSegments(result.duration);
                    }
                }
            };
        };
    }, []);

    useEffect(() => {
        logger.log("Segments updated:", segments);
    }, [segments]);

    // Virtual Player Logic
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const targetSourceTime = virtualToSourceTime(currentTime, segments);

        if (targetSourceTime !== null) {
            const diff = Math.abs((video.currentTime * 1000) - targetSourceTime);
            if (diff > 100) {
                video.currentTime = targetSourceTime / 1000;
            }
        }

        if (isPlaying && video.paused) {
            video.play().catch(console.error);
        } else if (!isPlaying && !video.paused) {
            video.pause();
        }

    }, [currentTime, isPlaying, segments]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !isPlaying) return;

        let rAFId: number;

        const loop = () => {
            const currentSourceMs = video.currentTime * 1000;
            let foundSeg = false;
            for (const seg of segments) {
                if (currentSourceMs >= seg.sourceStart && currentSourceMs < seg.sourceEnd) {
                    const offset = currentSourceMs - seg.sourceStart;
                    let virtualStartOfSeg = 0;
                    for (const s of segments) {
                        if (s.id === seg.id) break;
                        virtualStartOfSeg += (s.sourceEnd - s.sourceStart);
                    }
                    setCurrentTime(virtualStartOfSeg + offset);
                    foundSeg = true;
                    break;
                }
            }

            if (!foundSeg && segments.length > 0) {
                const nextSeg = segments.find((s: any) => s.sourceStart > currentSourceMs);
                if (nextSeg) {
                    video.currentTime = nextSeg.sourceStart / 1000;
                } else {
                    const lastSeg = segments[segments.length - 1];
                    if (currentSourceMs > lastSeg.sourceEnd) {
                        setIsPlaying(false);
                        return;
                    }
                }
            }

            rAFId = requestAnimationFrame(loop);
        };

        loop();
        return () => cancelAnimationFrame(rAFId);
    }, [isPlaying, segments]);

    // Handle Resize for Centering
    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
            }
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    // Calculate Schedule when metadata/video ready


    // Video Dimensions & Rendering Logic - Moved to top


    // Visualization Update Loop
    // Removed overlay visualization logic as it moved to PlayerCanvas


    // Calculate Rendered Rect (for overlay positioning)
    let renderedStyle = {};
    if (outputVideoSize && outputVideoSize.width > 0) {
        const containerAspect = containerSize.width / containerSize.height;
        const videoAspect = outputVideoSize.width / outputVideoSize.height;

        let rw, rh;
        if (containerAspect > videoAspect) {
            rh = containerSize.height;
            rw = rh * videoAspect;
        } else {
            rw = containerSize.width;
            rh = rw / videoAspect;
        }

        renderedStyle = {
            width: rw,
            height: rh
        };
    }

    // Tooltip Logic
    const [tooltip, setTooltip] = useState<{ x: number, y: number, text: string } | null>(null);

    const handleMouseMove = (e: React.MouseEvent) => {
        // inputVideoSize from store
        if (!inputVideoSize || !inputVideoSize.width || Object.keys(renderedStyle).length === 0) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Rendered Width/Height
        const rw = (renderedStyle as any).width;
        const rh = (renderedStyle as any).height;

        // Calculate coords relative to source video
        const scaleX = rw / inputVideoSize.width;
        const scaleY = rh / inputVideoSize.height;

        const sx = x / scaleX;
        const sy = y / scaleY;

        setTooltip({
            x: e.clientX + 15,
            y: e.clientY + 15,
            text: `X: ${Math.round(sx)}, Y: ${Math.round(sy)}`
        });
    };

    const handleMouseLeave = () => {
        setTooltip(null);
    };



    return (
        <div className="w-full h-screen bg-black flex flex-col overflow-hidden">
            <div className="flex-1 flex overflow-hidden">
                <div
                    id="video-player-container"
                    className="flex-1 flex overflow-hidden relative items-center justify-center bg-[#1e1e1e]"
                >
                    <div
                        ref={containerRef}
                        className="relative flex items-center justify-center shadow-2xl"
                        style={{
                            width: '100%',
                            height: '100%',
                            overflow: 'hidden'
                        }}
                    >
                        {videoUrl && (
                            <div
                                className="bg-blue-200"
                                style={{ position: 'relative', ...renderedStyle }}
                                onMouseMove={handleMouseMove}
                                onMouseLeave={handleMouseLeave}
                            >
                                <PlayerCanvas
                                    ref={videoRef}
                                    src={videoUrl}
                                    onLoadedMetadata={onVideoLoaded}
                                    muted
                                />

                                {/* All event markers (faint) */}
                                {metadata.map(() => {
                                    return null;
                                })}
                            </div>
                        )}
                        {!videoUrl && <div className="text-white">Loading...</div>}
                    </div>

                    {/* Tooltip */}
                    {tooltip && (
                        <div style={{
                            position: 'fixed',
                            left: tooltip.x + 10,
                            top: tooltip.y + 10,
                            zIndex: 9999,
                            background: 'rgba(0, 0, 0, 0.8)',
                            color: 'white',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            pointerEvents: 'none',
                            whiteSpace: 'nowrap'
                        }}>
                            {tooltip.text}
                        </div>
                    )}
                </div>

                <div id="debug-side-panel" className="w-80 bg-[#252526] border-l border-[#333] flex flex-col overflow-hidden text-xs text-gray-300">
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <EventInspector metadata={metadata as unknown as ZoomEvent[]} />
                    </div>
                    <div className="flex-1 flex flex-col overflow-hidden border-t border-[#333]">
                        <ZoomInspector
                            schedule={schedule}
                            currentTime={currentTime}
                        />
                    </div>
                </div>
            </div>

            <div id="timeline-container" className="h-64 border-t border-[#333] shrink-0 z-20 bg-[#1e1e1e]">
                <Timeline />
            </div>
        </div>
    );
}

export default Editor;
