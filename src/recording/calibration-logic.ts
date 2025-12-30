/**
 * @fileoverview Calibration Logic for Offscreen Document
 * 
 * Helper utilities for calibration functionality used by the offscreen document.
 */

import { type Size } from '../core/types';

// Calibration state interface
interface CalibrationState {
    isCalibrating: boolean;
    targetSize: Size | null;
    currentSize: Size | null;
}

let calibrationState: CalibrationState = {
    isCalibrating: false,
    targetSize: null,
    currentSize: null
};

/**
 * Start calibration process
 */
export function startCalibration(targetSize: Size): void {
    calibrationState = {
        isCalibrating: true,
        targetSize,
        currentSize: null
    };
}

/**
 * Update current calibration size
 */
export function updateCalibrationSize(currentSize: Size): void {
    calibrationState.currentSize = currentSize;
}

/**
 * Check if calibration is complete
 */
export function isCalibrated(): boolean {
    if (!calibrationState.targetSize || !calibrationState.currentSize) {
        return false;
    }

    const tolerance = 5; // pixels
    return (
        Math.abs(calibrationState.targetSize.width - calibrationState.currentSize.width) <= tolerance &&
        Math.abs(calibrationState.targetSize.height - calibrationState.currentSize.height) <= tolerance
    );
}

/**
 * End calibration and reset state
 */
export function endCalibration(): Size | null {
    const finalSize = calibrationState.currentSize;
    calibrationState = {
        isCalibrating: false,
        targetSize: null,
        currentSize: null
    };
    return finalSize;
}

/**
 * Get current calibration state
 */
export function getCalibrationState(): CalibrationState {
    return { ...calibrationState };
}
