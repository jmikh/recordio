import { useEffect, useRef, useState } from 'react';
import { getDeviceFrame } from '@shared/utils/deviceFrames';
import { useProjectStore } from '../../../editor/stores/useProjectStore';
import { useMediaUrlStore } from '../../../storage/useMediaUrlStore';
import {
    SAMPLE_CAMERA_SIZE,
    SAMPLE_CAMERA_URL,
    SAMPLE_SCREEN_SIZE,
    SAMPLE_SCREEN_URL,
} from '../../../core/sampleMedia';
import type { DemoKind } from '../../../core/effectDemos';
import { useDefaultsPreviewStore } from '../../../editor/stores/useDefaultsPreviewStore';
import { useDefaultsPreviewRenderer } from './useDefaultsPreviewRenderer';

const DEMO_LABEL: Record<DemoKind, string> = {
    click: 'click effect',
    keyboard: 'keyboard hotkeys',
    zoom: 'auto-zoom',
    shrink: 'auto shrink',
    spotlight: 'spotlight',
};

/** Height reserved above the canvas for the "Playing …" badge, so showing it never moves the canvas. */
const BADGE_ROW_PX = 28;

/**
 * The right half of the Personal Settings card: the defaults rendered on a
 * sample recording (plans/user-default-project-settings §3.8). A still
 * frame by default; the Preview buttons in the settings column play short
 * effect demos on it.
 */
export function DefaultsPreview() {
    const project = useProjectStore(s => s.project);
    const userEvents = useProjectStore(s => s.userEvents);
    const mediaUrls = useMediaUrlStore(s => s.urls);
    const playing = useDefaultsPreviewStore(s => s.playing);

    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const backgroundRef = useRef<HTMLImageElement>(null);
    const deviceFrameRef = useRef<HTMLImageElement>(null);
    const screenRef = useRef<HTMLImageElement>(null);
    const cameraRef = useRef<HTMLImageElement>(null);
    const [box, setBox] = useState({ width: 0, height: 0 });
    const [mediaError, setMediaError] = useState(false);

    const { scheduleStill } = useDefaultsPreviewRenderer(canvasRef, backgroundRef, deviceFrameRef, screenRef, cameraRef);

    // Resources — same resolution rules as the editor canvas
    const bg = project.settings.background;
    const bgUrl = (bg.storagePath && mediaUrls[bg.storagePath]) || bg.imageUrl;
    const showBgImage = (bg.type === 'preset' || bg.type === 'custom') && !!bgUrl;
    const deviceFrame = project.settings.screen.mode === 'device'
        ? getDeviceFrame(project.settings.screen.deviceFrameId)
        : undefined;

    // Fit the canvas into the available box at the output aspect ratio
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setBox({ width, height });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const { outputSize } = project.settings;
    const aspect = outputSize.width / outputSize.height;
    const fitWidth = Math.max(0, Math.floor(Math.min(box.width, (box.height - BADGE_ROW_PX) * aspect)));
    const fitHeight = Math.max(0, Math.floor(fitWidth / aspect));

    // Redraw the still whenever the template or a resource changes
    useEffect(() => {
        scheduleStill();
    }, [project, userEvents, bgUrl, deviceFrame?.imageUrl, fitWidth, fitHeight, scheduleStill]);

    return (
        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-surface-body">
            <div className="px-5 pt-4">
                <span className="text-eyebrow">Preview · sample recording</span>
            </div>

            <div ref={containerRef} className="flex-1 min-h-0 min-w-0 flex flex-col items-center justify-center p-5">
                {/* Always in the layout; only its content comes and goes */}
                <div className="shrink-0 flex items-center justify-center" style={{ height: BADGE_ROW_PX }}>
                    {playing && (
                        <span className="text-badge rounded-[var(--radius-sm)] px-2 py-1 bg-primary/10 text-primary" role="status">
                            Playing {DEMO_LABEL[playing]}
                        </span>
                    )}
                </div>
                <div
                    className="relative rounded-[var(--radius-md)] shadow-sm overflow-hidden bg-surface"
                    style={{ width: fitWidth, height: fitHeight }}
                >
                    <canvas ref={canvasRef} className="block w-full h-full" aria-label="Preview of your default settings on a sample recording" />
                    {mediaError && (
                        <span className="absolute left-2 top-2 text-label rounded-[var(--radius-sm)] px-2 py-1 bg-surface-raised border border-border">
                            Sample media unavailable
                        </span>
                    )}
                </div>
            </div>

            <p className="text-label px-5 pb-4">
                Use Preview next to an effect to see it play here.
            </p>

            {/* Hidden resources — decoded here, drawn by the renderer */}
            <div className="hidden" aria-hidden="true">
                <img
                    ref={screenRef}
                    src={SAMPLE_SCREEN_URL}
                    width={SAMPLE_SCREEN_SIZE.width}
                    height={SAMPLE_SCREEN_SIZE.height}
                    crossOrigin="anonymous"
                    alt=""
                    onLoad={scheduleStill}
                    onError={() => setMediaError(true)}
                />
                <img
                    ref={cameraRef}
                    src={SAMPLE_CAMERA_URL}
                    width={SAMPLE_CAMERA_SIZE.width}
                    height={SAMPLE_CAMERA_SIZE.height}
                    crossOrigin="anonymous"
                    alt=""
                    onLoad={scheduleStill}
                    onError={() => setMediaError(true)}
                />
                {showBgImage && (
                    <img
                        ref={backgroundRef}
                        src={bgUrl}
                        crossOrigin={bgUrl!.startsWith('blob:') ? undefined : 'anonymous'}
                        alt=""
                        onLoad={scheduleStill}
                    />
                )}
                {deviceFrame && (
                    <img
                        ref={deviceFrameRef}
                        src={deviceFrame.imageUrl}
                        crossOrigin="anonymous"
                        alt=""
                        onLoad={scheduleStill}
                    />
                )}
            </div>
        </div>
    );
}
