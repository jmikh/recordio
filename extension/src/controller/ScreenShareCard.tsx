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
        <div className={`bg-surface-raised rounded-xl border overflow-hidden transition-all duration-300 ease-in-out ${activeTab === 'screen' ? 'border-primary/30 shadow-sm' : 'border-border'}`}>
            <button
                className="flex items-center justify-between w-full px-4 py-3 cursor-pointer hover:bg-surface/50 transition-colors"
                onClick={() => {
                    const wasCollapsed = activeTab !== 'screen';
                    setActiveTab('screen');
                    if (wasCollapsed && !hasSource) chooseSource();
                }}
            >
                <span className={`text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'screen' ? 'text-primary' : 'text-text-main'} w-[130px] justify-start`}>
                    <CgScreen size={16} />
                    Share Screen
                </span>
                {activeTab !== 'screen' && (
                    <span className="text-xs font-normal text-text-muted truncate max-w-[150px]">
                        {hasSource ? sharingLabel : 'Not sharing'}
                    </span>
                )}
                {/* Dummy element to balance flex layout (matches Toggle width) */}
                <div className="w-11" />
            </button>
            <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{ maxHeight: activeTab === 'screen' ? '440px' : '0px', opacity: activeTab === 'screen' ? 1 : 0 }}
            >
                <div className="px-4 pb-4 border-t border-border">
                    <div className="flex flex-col h-[340px] pt-3">
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
                            <div className="flex flex-col flex-1 items-center justify-center pb-2 w-full min-h-0">
                                <button
                                    className="relative flex items-center justify-center shrink-0 cursor-pointer hover:scale-105 transition-transform duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
                                    style={{ width: 80, height: 80 }}
                                    onClick={chooseSource}
                                    disabled={isChoosing}
                                    aria-label="Share screen"
                                >
                                    {/* Emitting ripple rings */}
                                    <div className="absolute inset-0 rounded-full border border-primary/40" style={{ opacity: 0, animation: 'ripple-out 2.4s ease-out infinite', animationFillMode: 'backwards' }} />
                                    <div className="absolute inset-0 rounded-full border border-primary/40" style={{ opacity: 0, animation: 'ripple-out 2.4s ease-out infinite', animationDelay: '0.8s', animationFillMode: 'backwards' }} />
                                    <div className="absolute inset-0 rounded-full border border-primary/40" style={{ opacity: 0, animation: 'ripple-out 2.4s ease-out infinite', animationDelay: '1.6s', animationFillMode: 'backwards' }} />
                                    {/* Fixed center icon */}
                                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/25 z-10">
                                        <CgScreen size={24} className="text-primary text-opacity-80" />
                                    </div>
                                </button>
                            </div>
                        )}

                        <div className="w-full relative z-20 mt-auto pt-3 shrink-0">
                            <Button
                                onClick={chooseSource}
                                disabled={isChoosing}
                                className="w-full shadow-sm"
                            >
                                {isChoosing ? 'Waiting...' : hasSource ? 'Change screen' : 'Share screen'}
                            </Button>
                        </div>
                    </div>
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
