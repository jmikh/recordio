import { Toggle, InfoTooltip } from '@shared/components';
import { CDN_ORIGIN } from '@shared/types/bridge';
import { TbZoomIn } from 'react-icons/tb';
import { RiLightbulbFlashLine } from 'react-icons/ri';
import { CgToolbarTop } from 'react-icons/cg';
import { IoSettingsOutline } from 'react-icons/io5';
import type { ControllerTab } from './ControllerApp';

export function EffectsCard({
    activeTab, setActiveTab,
    hasSource, showPostProcessing,
    applyAutoZoom, setApplyAutoZoom,
    applySpotlight, setApplySpotlight,
    simplifyToolbar, setSimplifyToolbar,
}: {
    activeTab: ControllerTab;
    setActiveTab: (tab: ControllerTab) => void;
    hasSource: boolean;
    showPostProcessing: boolean;
    applyAutoZoom: boolean;
    setApplyAutoZoom: (v: boolean) => void;
    applySpotlight: boolean;
    setApplySpotlight: (v: boolean) => void;
    simplifyToolbar: boolean;
    setSimplifyToolbar: (v: boolean) => void;
}) {
    return (
        <div className={`bg-surface-raised rounded-xl border overflow-hidden transition-all duration-300 ease-in-out ${activeTab === 'effects' ? 'border-primary/30 shadow-sm' : 'border-border'}`}>
            <button
                className="flex items-center justify-between w-full px-4 py-3 cursor-pointer hover:bg-surface/50 transition-colors"
                onClick={() => setActiveTab('effects')}
            >
                <span className={`text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === 'effects' ? 'text-primary' : 'text-text-main'}`}>
                    <IoSettingsOutline size={16} />
                    Effects Settings
                </span>
                {activeTab !== 'effects' && (
                    <div className="flex items-center gap-2">
                        {hasSource && !showPostProcessing ? (
                            <span className="text-xs font-normal text-text-disabled">Unavailable</span>
                        ) : (
                            <>
                                <div className={`flex items-center gap-1 ${applyAutoZoom ? 'text-text-main' : 'text-text-disabled'}`}><TbZoomIn size={14} /><span className="text-xs font-medium">{applyAutoZoom ? 'On' : 'Off'}</span></div>
                                <div className={`flex items-center gap-1 ${applySpotlight ? 'text-text-main' : 'text-text-disabled'}`}><RiLightbulbFlashLine size={14} /><span className="text-xs font-medium">{applySpotlight ? 'On' : 'Off'}</span></div>
                                <div className={`flex items-center gap-1 ${simplifyToolbar ? 'text-text-main' : 'text-text-disabled'}`}><CgToolbarTop size={14} /><span className="text-xs font-medium">{simplifyToolbar ? 'On' : 'Off'}</span></div>
                            </>
                        )}
                    </div>
                )}
            </button>
            <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{ maxHeight: activeTab === 'effects' ? '300px' : '0px', opacity: activeTab === 'effects' ? 1 : 0 }}
            >
                <div className="px-4 pb-4 border-t border-border">
                    <div className="flex flex-col gap-2 pt-3">
                        {hasSource && !showPostProcessing ? (
                            <p className="text-sm text-text-muted">
                                Auto effects only work when recording this browser window.
                            </p>
                        ) : (
                            <>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-text-muted">
                                        <span className="text-sm">Auto Zoom</span>
                                        <InfoTooltip
                                            placement="top-right"
                                            description="Recordio doesn't just follow the cursor. It understands the layout of all elements you are interacting with, producing meaningful zooms."
                                            videoSrc={`${CDN_ORIGIN}/demos/zoom.webm`}
                                        />
                                    </div>
                                    <Toggle value={applyAutoZoom} onChange={setApplyAutoZoom} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-text-muted">
                                        <span className="text-sm">Auto Spotlight</span>
                                        <InfoTooltip
                                            placement="top-right"
                                            description={"Shine the spotlight on what matters by enlarging it and dimming the rest.\nLooks best on cards, popovers and clearly defined areas."}
                                            videoSrc={`${CDN_ORIGIN}/demos/spotlight.webm`}
                                        />
                                    </div>
                                    <Toggle value={applySpotlight} onChange={setApplySpotlight} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-text-muted">
                                        <span className="text-sm">Simplify Toolbar</span>
                                        <InfoTooltip
                                            placement="top-right"
                                            description="Replace messy browser toolbars with a clean, unified macOS-style window header in your final video."
                                            videoSrc={`${CDN_ORIGIN}/demos/toolbar.webm`}
                                        />
                                    </div>
                                    <Toggle value={simplifyToolbar} onChange={setSimplifyToolbar} />
                                </div>
                            </>
                        )}
                    </div>
                    {(!hasSource || showPostProcessing) && (
                        <p className="text-xs text-text-disabled mt-3">These settings can be changed in the editor later.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
