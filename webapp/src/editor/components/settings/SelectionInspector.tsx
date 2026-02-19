/**
 * SelectionInspector — replaces the settings panel content when a timeline item
 * (zoom, spotlight, or window) is selected.
 *
 * Each sub-panel exposes item-specific controls (delete, sliders, dropdowns)
 * and an "Apply to All" action for zooms and spotlights.
 */

import React, { useCallback, useMemo } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore, CanvasMode } from '../../stores/useUIStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';
import { Slider, Dropdown, GhostButton, Tooltip, type DropdownOption } from '@shared/components';
import type { EasingStyle } from '../../../core/easing';
import type { ZoomSegment, SpotlightSegment, OutputWindow } from '../../../types';
import { MdDelete } from 'react-icons/md';
import { TbZoomIn, TbPlayerRecord } from 'react-icons/tb';
import { RiLightbulbFlashLine } from 'react-icons/ri';
import { VscCopy } from 'react-icons/vsc';

// ============================================================================
// Shared constants
// ============================================================================

const EASING_OPTIONS: DropdownOption<EasingStyle>[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
];

// ============================================================================
// Zoom Inspector
// ============================================================================

const ZoomInspector: React.FC<{ segment: ZoomSegment }> = ({ segment }) => {
    const updateZoomSegment = useProjectStore(s => s.updateZoomSegment);
    const deleteZoomSegment = useProjectStore(s => s.deleteZoomSegment);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const { batchAction } = useHistoryBatcher();

    const allZoomSegments = useProjectStore(s => s.project.timeline.zoomSegments);
    const zoomSettings = useProjectStore(s => s.project.settings.zoom);

    const handleDelete = useCallback(() => {
        deleteZoomSegment(segment.id);
        setCanvasMode(CanvasMode.Preview);
    }, [segment.id, deleteZoomSegment, setCanvasMode]);

    const handleTransitionChange = useCallback((val: number) => {
        batchAction(() => updateZoomSegment(segment.id, { transitionDurationMs: Math.round(val) }));
    }, [segment.id, batchAction, updateZoomSegment]);

    const handleEasingChange = useCallback((val: EasingStyle) => {
        updateZoomSegment(segment.id, { easing: val });
    }, [segment.id, updateZoomSegment]);

    const handleApplyToAll = useCallback(() => {
        const updates = {
            transitionDurationMs: segment.transitionDurationMs,
            easing: segment.easing,
        };
        for (const z of allZoomSegments) {
            if (z.id !== segment.id) {
                updateZoomSegment(z.id, updates);
            }
        }
        updateSettings({
            zoom: { ...zoomSettings, transitionDurationMs: segment.transitionDurationMs, easing: segment.easing }
        });
    }, [segment, allZoomSegments, zoomSettings, updateZoomSegment, updateSettings]);

    return (
        <div className="flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center gap-2.5">
                <TbZoomIn size={18} className="text-primary" />
                <span className="text-sm font-semibold text-text-main">Zoom</span>
            </div>

            {/* Transition Duration */}
            <Slider
                label="Transition"
                value={segment.transitionDurationMs}
                onChange={handleTransitionChange}
                min={100}
                max={1500}
                units="ms"
                showTooltip
            />

            {/* Easing */}
            <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-muted">Easing</span>
                <Dropdown
                    options={EASING_OPTIONS}
                    value={segment.easing}
                    onChange={handleEasingChange}
                />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
                <GhostButton onClick={handleApplyToAll} className="text-xs justify-start">
                    <VscCopy size={14} />
                    <span>Apply to All Zooms</span>
                </GhostButton>
                <GhostButton onClick={handleDelete} className="text-xs justify-start text-danger hover:text-danger">
                    <MdDelete size={16} />
                    <span>Delete Zoom</span>
                </GhostButton>
            </div>
        </div>
    );
};

// ============================================================================
// Spotlight Inspector
// ============================================================================

const SpotlightInspector: React.FC<{ segment: SpotlightSegment }> = ({ segment }) => {
    const updateSpotlight = useProjectStore(s => s.updateSpotlight);
    const deleteSpotlight = useProjectStore(s => s.deleteSpotlight);
    const updateSettings = useProjectStore(s => s.updateSettings);
    const setCanvasMode = useUIStore(s => s.setCanvasMode);
    const { batchAction } = useHistoryBatcher();

    const allSpotlightSegments = useProjectStore(s => s.project.timeline.spotlightSegments);
    const spotlightSettings = useProjectStore(s => s.project.settings.spotlight);

    const handleDelete = useCallback(() => {
        deleteSpotlight(segment.id);
        setCanvasMode(CanvasMode.Preview);
    }, [segment.id, deleteSpotlight, setCanvasMode]);

    const handleDimOpacityChange = useCallback((val: number) => {
        batchAction(() => updateSpotlight(segment.id, { dimOpacity: val }));
    }, [segment.id, batchAction, updateSpotlight]);

    const handleScaleChange = useCallback((val: number) => {
        batchAction(() => updateSpotlight(segment.id, { scale: val }));
    }, [segment.id, batchAction, updateSpotlight]);

    const handleTransitionChange = useCallback((val: number) => {
        batchAction(() => updateSpotlight(segment.id, { transitionDurationMs: Math.round(val) }));
    }, [segment.id, batchAction, updateSpotlight]);

    const handleEasingChange = useCallback((val: EasingStyle) => {
        updateSpotlight(segment.id, { easing: val });
    }, [segment.id, updateSpotlight]);

    const handleApplyToAll = useCallback(() => {
        const updates = {
            dimOpacity: segment.dimOpacity,
            scale: segment.scale,
            transitionDurationMs: segment.transitionDurationMs,
            easing: segment.easing,
        };
        for (const s of allSpotlightSegments) {
            if (s.id !== segment.id) {
                updateSpotlight(s.id, updates);
            }
        }
        updateSettings({
            spotlight: {
                ...spotlightSettings,
                dimOpacity: segment.dimOpacity,
                enlargeScale: segment.scale,
                transitionDurationMs: segment.transitionDurationMs,
                easing: segment.easing,
            }
        });
    }, [segment, allSpotlightSegments, spotlightSettings, updateSpotlight, updateSettings]);

    return (
        <div className="flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center gap-2.5">
                <RiLightbulbFlashLine size={18} className="text-secondary" />
                <span className="text-sm font-semibold text-text-main">Spotlight</span>
            </div>

            {/* Dim Opacity */}
            <Slider
                label="Dim"
                value={segment.dimOpacity}
                onChange={handleDimOpacityChange}
                min={0}
                max={1}
                decimals={0}
                units="%"
                valueTransform={(v) => v * 100}
                showTooltip
            />

            {/* Scale */}
            <Slider
                label="Enlarge"
                value={segment.scale}
                onChange={handleScaleChange}
                min={1}
                max={2}
                decimals={2}
                units="x"
                showTooltip
            />

            {/* Transition Duration */}
            <Slider
                label="Transition"
                value={segment.transitionDurationMs}
                onChange={handleTransitionChange}
                min={0}
                max={1000}
                units="ms"
                showTooltip
            />

            {/* Easing */}
            <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-muted">Easing</span>
                <Dropdown
                    options={EASING_OPTIONS}
                    value={segment.easing}
                    onChange={handleEasingChange}
                />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
                <GhostButton onClick={handleApplyToAll} className="text-xs justify-start">
                    <VscCopy size={14} />
                    <span>Apply to All Spotlights</span>
                </GhostButton>
                <GhostButton onClick={handleDelete} className="text-xs justify-start text-danger hover:text-danger">
                    <MdDelete size={16} />
                    <span>Delete Spotlight</span>
                </GhostButton>
            </div>
        </div>
    );
};

// ============================================================================
// Window Inspector
// ============================================================================

const WindowInspector: React.FC<{ window: OutputWindow }> = ({ window: win }) => {
    const updateOutputWindow = useProjectStore(s => s.updateOutputWindow);
    const removeOutputWindow = useProjectStore(s => s.removeOutputWindow);
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);
    const { batchAction } = useHistoryBatcher();

    const isLastWindow = outputWindows.length <= 1;

    const durationMs = (win.endMs - win.startMs) / (win.speed || 1);
    const durationDisplay = useMemo(() => {
        const totalSec = durationMs / 1000;
        const min = Math.floor(totalSec / 60);
        const sec = (totalSec % 60).toFixed(1);
        return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    }, [durationMs]);

    const handleSpeedChange = useCallback((val: number) => {
        batchAction(() => updateOutputWindow(win.id, { speed: Math.round(val * 10) / 10 }));
    }, [win.id, batchAction, updateOutputWindow]);

    const handleDelete = useCallback(() => {
        if (!isLastWindow) {
            removeOutputWindow(win.id);
        }
    }, [win.id, isLastWindow, removeOutputWindow]);

    return (
        <div className="flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center gap-2.5">
                <TbPlayerRecord size={18} className="text-text-main" />
                <span className="text-sm font-semibold text-text-main">Clip</span>
            </div>

            {/* Duration (read-only) */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-muted">Duration</span>
                <span className="text-xs text-text-main font-mono">{durationDisplay}</span>
            </div>

            {/* Speed */}
            <Slider
                label="Speed"
                value={win.speed || 1}
                onChange={handleSpeedChange}
                min={0.5}
                max={3}
                decimals={1}
                units="x"
                showTooltip
            />

            {/* Delete */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
                {isLastWindow ? (
                    <Tooltip text="Cannot delete the last clip">
                        <GhostButton disabled className="text-xs justify-start opacity-50">
                            <MdDelete size={16} />
                            <span>Delete Clip</span>
                        </GhostButton>
                    </Tooltip>
                ) : (
                    <GhostButton onClick={handleDelete} className="text-xs justify-start text-danger hover:text-danger">
                        <MdDelete size={16} />
                        <span>Delete Clip</span>
                    </GhostButton>
                )}
            </div>
        </div>
    );
};

// ============================================================================
// Main SelectionInspector
// ============================================================================

export const SelectionInspector: React.FC = () => {
    const selectedZoomId = useUIStore(s => s.selectedZoomId);
    const selectedSpotlightId = useUIStore(s => s.selectedSpotlightId);
    const selectedWindowId = useUIStore(s => s.selectedWindowId);

    const zoomSegments = useProjectStore(s => s.project.timeline.zoomSegments);
    const spotlightSegments = useProjectStore(s => s.project.timeline.spotlightSegments);
    const outputWindows = useProjectStore(s => s.project.timeline.outputWindows);

    const selectedZoom = selectedZoomId ? zoomSegments.find(z => z.id === selectedZoomId) : null;
    const selectedSpotlight = selectedSpotlightId ? spotlightSegments.find(s => s.id === selectedSpotlightId) : null;
    const selectedWindow = selectedWindowId ? outputWindows.find(w => w.id === selectedWindowId) : null;

    if (selectedZoom) return <ZoomInspector segment={selectedZoom} />;
    if (selectedSpotlight) return <SpotlightInspector segment={selectedSpotlight} />;
    if (selectedWindow) return <WindowInspector window={selectedWindow} />;

    return null;
};
