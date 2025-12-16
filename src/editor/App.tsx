import { useState, useEffect, useRef } from 'react';
import { useEditorStore, type Metadata } from './store';
import { Timeline } from './Timeline';
import { virtualToSourceTime } from './utils';

function Editor() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });

    // Store State
    const {
        videoUrl,
        metadata,
        recordingStartTime,
        isExporting,
        zoomIntensity,
        segments,
        currentTime,
        isPlaying,
        setVideoUrl,
        setMetadata,
        setRecordingStartTime,
        setIsExporting,
        setZoomIntensity,
        initSegments,
        setCurrentTime,
        setIsPlaying
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
                    if (result.timestamp) setRecordingStartTime(result.timestamp);

                    // Initialize segments with reliable duration if available
                    if (result.duration && result.duration > 0 && result.duration !== Infinity) {
                        initSegments(result.duration);
                    }
                }
            };
        };
    }, []);

    // Fallback Initialization on Video Load (if DB didn't have duration)
    // We only init if segments are empty    // Initialize Segments on Video Load
    const onVideoLoaded = () => {
        if (segments.length === 0 && videoRef.current) {
            const duration = videoRef.current.duration;
            console.log("Video loaded. Duration:", duration);
            if (isFinite(duration) && duration > 0) {
                initSegments(duration * 1000);
            } else {
                console.warn("Video duration is infinite/invalid, timeline might be broken until full load.");
            }
        }
    };

    useEffect(() => {
        console.log("Segments updated:", segments);
    }, [segments]);

    // Virtual Player Logic
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Sync Store -> Video (Seek)
        // Only seek if difference is significant to avoid stutter during playback
        const targetSourceTime = virtualToSourceTime(currentTime, segments);

        if (targetSourceTime !== null) {
            const diff = Math.abs((video.currentTime * 1000) - targetSourceTime);
            if (diff > 100) { // 100ms tolerance
                video.currentTime = targetSourceTime / 1000;
            }
        }

        // Play/Pause Sync
        if (isPlaying && video.paused) {
            video.play().catch(console.error);
        } else if (!isPlaying && !video.paused) {
            video.pause();
        }

    }, [currentTime, isPlaying, segments]);

    // Video Time Update Loop (The heartbeat of the virtual player)
    // Uses requestAnimationFrame for smooth 60fps updates instead of timeupdate (4hz)
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !isPlaying) return;

        let rAFId: number;

        const loop = () => {
            const currentSourceMs = video.currentTime * 1000;

            // Find which segment we are in
            let foundSeg = false;
            for (const seg of segments) {
                if (currentSourceMs >= seg.sourceStart && currentSourceMs < seg.sourceEnd) {
                    // Inside a segment, update virtual time
                    const offset = currentSourceMs - seg.sourceStart;
                    let virtualStartOfSeg = 0; // Calculate accumulated start
                    for (const s of segments) {
                        if (s.id === seg.id) break;
                        virtualStartOfSeg += (s.sourceEnd - s.sourceStart);
                    }
                    setCurrentTime(virtualStartOfSeg + offset);
                    foundSeg = true;
                    break;
                }
            }

            // Gap Jumping Logic
            if (!foundSeg && segments.length > 0) {
                // If we are not in a segment, we probably drifted or reached end of one.
                // Find the NEXT segment start
                const nextSeg = segments.find(s => s.sourceStart > currentSourceMs);
                if (nextSeg) {
                    // Jump to start of next segment
                    video.currentTime = nextSeg.sourceStart / 1000;
                } else {
                    // End of all segments
                    // Only stop if we really are past everything
                    const lastSeg = segments[segments.length - 1];
                    if (currentSourceMs > lastSeg.sourceEnd) {
                        setIsPlaying(false);
                        return; // Stop loop
                    }
                }
            }

            rAFId = requestAnimationFrame(loop);
        };

        // Start loop
        loop();

        return () => cancelAnimationFrame(rAFId);
    }, [isPlaying, segments]);


    // Zoom & Transform Logic (Existing, adapted)
    useEffect(() => {
        // ... (Keep existing zoom logic but mapping source time)
        // For simplicity, we keep using source time for Zoom detection since metadata is absolute timestamp based.
        // We might need to map virtual time -> absolute time for better UX later, but this works for now.
        const video = videoRef.current;
        if (!video) return;

        const handleTransform = () => {
            const currentTime = video.currentTime * 1000; // ms source time
            const absTime = recordingStartTime + currentTime;
            const ZOOM_DURATION = 3000;

            const activeEvent = metadata.find(m => {
                const diff = absTime - m.timestamp;
                return diff >= 0 && diff < ZOOM_DURATION;
            });

            if (activeEvent) {
                const padding = 200;
                const targetWidth = activeEvent.width + padding;
                const targetHeight = activeEvent.height + padding;
                const scaleX = activeEvent.viewportWidth / targetWidth;
                const scaleY = activeEvent.viewportHeight / targetHeight;
                const scale = Math.min(Math.max(Math.min(scaleX, scaleY), 1.2), 3);

                const eventViewportX = activeEvent.x - activeEvent.scrollX;
                const eventViewportY = activeEvent.y - activeEvent.scrollY;
                const eventCenterX = eventViewportX + activeEvent.width / 2;
                const eventCenterY = eventViewportY + activeEvent.height / 2;

                const containerW = containerRef.current?.clientWidth || 800;
                const containerH = containerRef.current?.clientHeight || 450;
                const x = (containerW / 2) - (eventCenterX * scale);
                const y = (containerH / 2) - (eventCenterY * scale); // Fixed typo from prev: eventCenterY * scale

                setTransform({ x, y, scale });
            } else {
                setTransform({ x: 0, y: 0, scale: zoomIntensity }); // Use global zoom setting if no event
            }
        };

        video.addEventListener('timeupdate', handleTransform);
        return () => video.removeEventListener('timeupdate', handleTransform);
    }, [metadata, recordingStartTime, zoomIntensity]);


    // Export Logic (Complex, needs to respect segments)
    const exportVideo = async () => {
        if (!videoRef.current || !videoUrl) return;
        setIsExporting(true);
        const video = videoRef.current;
        const width = video.videoWidth;
        const height = video.videoHeight;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const stream = canvas.captureStream(30);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `recordo-export-${Date.now()}.webm`;
            a.click();
            setIsExporting(false);
        };

        recorder.start();

        // Render Loop for Segments
        // We must manually play through each segment
        video.pause();

        for (const seg of segments) {
            await new Promise<void>((resolve) => {
                const startSec = seg.sourceStart / 1000;
                const endSec = seg.sourceEnd / 1000;
                video.currentTime = startSec;

                const onSeeked = () => {
                    video.removeEventListener('seeked', onSeeked);
                    video.play();
                };
                video.addEventListener('seeked', onSeeked);

                const checkTime = () => {
                    if (video.currentTime >= endSec || video.ended) {
                        video.pause();
                        video.removeEventListener('timeupdate', checkTime);
                        resolve();
                    }
                    // Draw frame
                    ctx.drawImage(video, 0, 0, width, height);
                    // TODO: Apply zoom transforms here too if we want them in export
                };
                video.addEventListener('timeupdate', checkTime);
            });
        }

        recorder.stop();
    };

    const videoStyle = {
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        transformOrigin: '0 0'
    };

    return (
        <div className="w-full h-screen bg-black flex flex-col overflow-hidden">
            {/* Main Area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Editor Surface */}
                <div className="flex-1 flex flex-col items-center justify-center p-4 bg-slate-900 relative">
                    <div
                        ref={containerRef}
                        className="relative overflow-hidden border-4 border-slate-700 shadow-2xl bg-black transition-all"
                        style={{
                            width: '100%',
                            maxWidth: '1280px',
                            aspectRatio: '16/9',
                            maxHeight: 'calc(100vh - 250px)'
                        }}
                    >
                        {videoUrl ? (
                            <video
                                ref={videoRef}
                                src={videoUrl}
                                onLoadedMetadata={onVideoLoaded}
                                className="w-full h-full object-contain"
                                style={videoStyle}
                                muted={false} // Ensure audio plays
                            />
                        ) : (
                            <div className="text-white flex items-center justify-center h-full">Loading...</div>
                        )}
                    </div>
                </div>

                {/* Sidebar (Zoom & settings) */}
                <div className="w-80 bg-slate-900 border-l border-slate-700 flex flex-col gap-6 overflow-y-auto">
                    <div className="p-4 border-b border-slate-700">
                        <h2 className="text-xl font-bold text-white mb-4">Settings</h2>
                        <div className="mb-4">
                            <label className="block text-xs text-slate-500 uppercase mb-1">Global Zoom</label>
                            <input
                                type="range" min="1" max="3" step="0.1"
                                value={zoomIntensity}
                                onChange={(e) => setZoomIntensity(parseFloat(e.target.value))}
                                className="w-full"
                            />
                        </div>
                        <button
                            onClick={exportVideo}
                            disabled={isExporting}
                            className={`w-full py-2 rounded font-medium transition-colors ${isExporting ? 'bg-slate-600' : 'bg-green-600 hover:bg-green-700 text-white'}`}
                        >
                            {isExporting ? 'Exporting...' : 'Export Video'}
                        </button>
                    </div>

                    <div className="p-4">
                        <h3 className="text-xs text-slate-500 uppercase mb-2">Debug</h3>
                        <div className="text-xs text-slate-400 font-mono mb-2">
                            Segments: {segments.length}<br />
                            Duration: {segments.reduce((acc, s) => acc + (s.sourceEnd - s.sourceStart), 0).toFixed(0)}ms
                        </div>
                        <button
                            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded w-full mb-2"
                            onClick={() => {
                                if (videoRef.current) {
                                    const d = videoRef.current.duration;
                                    console.log("Video Duration:", d);
                                    if (isFinite(d)) initSegments(d * 1000);
                                    else alert("Video duration is Infinite. Cannot reset.");
                                }
                            }}
                        >
                            Reset Timeline (Video Duration)
                        </button>
                        <button
                            className="text-xs bg-red-900/50 hover:bg-red-900/80 text-red-200 px-2 py-1 rounded w-full"
                            onClick={() => {
                                // Hard reset to test
                                initSegments(10000); // 10s dummy
                            }}
                        >
                            Force 10s Timeline
                        </button>
                    </div>
                </div>
            </div>

            {/* Timeline Area (Fixed Height at Bottom) */}
            <div className="h-48 z-10 shrink-0">
                <Timeline />
            </div>
        </div>
    );
}

export default Editor;
