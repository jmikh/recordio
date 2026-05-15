import type { RefObject } from 'react';
import { Button } from '@shared/components';
import { CgScreen } from 'react-icons/cg';
import type { ControllerTab } from './ControllerApp';

export function ScreenShareCard({
    activeTab, setActiveTab,
    hasSource, sharingLabel,
    isChoosing, chooseSource,
    previewVideoRef,
}: {
    activeTab: ControllerTab;
    setActiveTab: (tab: ControllerTab) => void;
    hasSource: boolean;
    sharingLabel: string;
    isChoosing: boolean;
    chooseSource: () => void;
    previewVideoRef: RefObject<HTMLVideoElement | null>;
}) {
    return (
        <div className={`bg-surface-raised rounded-xl border overflow-hidden ${hasSource ? 'border-primary/30 shadow-sm' : 'border-border'}`}>
            <div className="flex items-center px-4 py-3">
                <span className={`text-sm font-medium flex items-center gap-2 ${hasSource ? 'text-primary' : 'text-text-main'}`}>
                    <CgScreen size={16} />
                    Share Screen
                </span>
            </div>
            <div className="px-4 pb-4 border-t border-border">
                <div className="flex flex-col h-60 pt-3">
                    {hasSource ? (
                        <div className="flex-1 flex flex-col items-center w-full min-h-0 animate-in fade-in duration-200">
                            <div className="flex-1 w-full bg-surface rounded-lg overflow-hidden border border-border flex items-center justify-center min-h-0">
                                <video
                                    ref={previewVideoRef}
                                    autoPlay
                                    muted
                                    playsInline
                                    className="w-full h-full object-contain bg-surface"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col flex-1 items-center justify-center gap-4 w-full min-h-0">
                            <div className="flex flex-col items-center gap-2 text-text-muted">
                                <CgScreen size={32} className="text-text-disabled" />
                                <span className="text-xs text-text-disabled">No screen selected</span>
                            </div>
                            <Button
                                onClick={chooseSource}
                                disabled={isChoosing}
                                className="shadow-sm"
                            >
                                {isChoosing ? 'Waiting...' : 'Choose screen'}
                            </Button>
                        </div>
                    )}

                    {hasSource && (
                        <div className="w-full relative z-20 mt-auto pt-3 shrink-0">
                            <Button
                                onClick={chooseSource}
                                disabled={isChoosing}
                                className="w-full shadow-sm"
                            >
                                {isChoosing ? 'Waiting...' : 'Change screen'}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function CalibrationMarkers() {
    const markerStyle = "fixed w-[50px] h-[50px] z-[9999] flex items-center justify-center";
    const primaryBg = "bg-[oklch(0.58_0.19_290)]";
    const secondaryBg = "bg-[oklch(0.80_0.15_78)]";

    return (
        <>
            <div className={`${markerStyle} ${primaryBg} top-0 left-0`}>
                <div className={`w-5 h-5 ${secondaryBg}`} />
            </div>
            <div className={`${markerStyle} ${primaryBg} top-0 right-0`}>
                <div className={`w-5 h-5 ${secondaryBg}`} />
            </div>
            <div className={`${markerStyle} ${primaryBg} bottom-0 left-0`}>
                <div className={`w-5 h-5 ${secondaryBg}`} />
            </div>
            <div className={`${markerStyle} ${primaryBg} bottom-0 right-0`}>
                <div className={`w-5 h-5 ${secondaryBg}`} />
            </div>
        </>
    );
}
