import React from 'react';
import type { EasingStyle } from '../../../core/easing';

// SVG easing curve paths (displayed in a 32x32 viewBox)
const EASING_CURVES: Record<EasingStyle, string> = {
    'linear': 'M 4 28 L 28 4',
    'ease-in': 'M 4 28 C 4 28 20 28 28 4',
    'ease-out': 'M 4 28 C 4 4 24 4 28 4',
    'ease-in-out': 'M 4 28 C 4 16 28 16 28 4',
};

const EASING_DESCRIPTIONS: Record<EasingStyle, string> = {
    'linear': 'Constant speed, no acceleration',
    'ease-in': 'Starts slow, accelerates',
    'ease-out': 'Starts fast, decelerates',
    'ease-in-out': 'Starts slow, speeds up, then slows down',
};

const EASING_LABELS: Record<EasingStyle, string> = {
    'linear': 'Linear',
    'ease-in': 'Ease In',
    'ease-out': 'Ease Out',
    'ease-in-out': 'Ease In Out',
};

/** Shared tooltip content showing all easing curve visualizations */
export const EasingTooltipContent: React.FC = () => (
    <div className="flex flex-col gap-2 px-3 py-2">
        {(Object.keys(EASING_CURVES) as EasingStyle[]).map((style) => (
            <div key={style} className="flex items-center gap-2.5">
                <svg width="32" height="32" viewBox="0 0 32 32" className="flex-shrink-0">
                    {/* Axes */}
                    <line x1="4" y1="28" x2="28" y2="28" stroke="var(--text-disabled)" strokeWidth="1" />
                    <line x1="4" y1="28" x2="4" y2="4" stroke="var(--text-disabled)" strokeWidth="1" />
                    {/* Curve */}
                    <path d={EASING_CURVES[style]} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <div className="flex flex-col">
                    <span className="text-text-main text-xs font-medium">{EASING_LABELS[style]}</span>
                    <span className="text-text-muted text-[11px]">{EASING_DESCRIPTIONS[style]}</span>
                </div>
            </div>
        ))}
    </div>
);
