/**
 * @fileoverview Google Analytics 4 Integration via gtag.js
 * 
 * The gtag.js script is loaded in index.html. This module provides
 * typed helper functions for tracking custom events.
 */

// Declare gtag on window
declare global {
    interface Window {
        gtag: (...args: any[]) => void;
    }
}

function trackEvent(eventName: string, params: Record<string, any> = {}) {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', eventName, params);
}

// ============================================================================
// Public API - Specific Event Tracking Functions
// ============================================================================

export interface ExportCompletedParams {
    quality: '360p' | '720p' | '1080p' | '4K';
    duration_seconds: number;
    auto_zoom: boolean;
    is_authenticated: boolean;
    is_pro: boolean;
}

export function trackExportCompleted(params: ExportCompletedParams) {
    trackEvent('export_completed', params);
}

export interface CaptionsGeneratedParams {
    segment_count: number;
    is_authenticated: boolean;
    is_pro: boolean;
}

export function trackCaptionsGenerated(params: CaptionsGeneratedParams) {
    trackEvent('captions_generated', params);
}
