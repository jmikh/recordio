import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { MultiToggle } from '../../../components/ui/MultiToggle';


const GRADIENT_DIRECTIONS = ['NW', 'N', 'NE', 'W', '', 'E', 'SW', 'S', 'SE'] as const;

const PRESET_COLORS = [
    // Pastels
    '#fecaca', // Red-200
    '#fed7aa', // Orange-200
    '#fde68a', // Amber-200
    '#d9f99d', // Lime-200
    '#bbf7d0', // Green-200
    '#99f6e4', // Teal-200
    '#a5f3fc', // Cyan-200
    '#bae6fd', // Sky-200
    '#c7d2fe', // Indigo-200
    '#ddd6fe', // Violet-200
    '#f5d0fe', // Fuchsia-200
    '#fbcfe8', // Pink-200
    '#e2e8f0', // Slate-200
    '#ffffff'  // White replacement? Or just keep slate.
];

interface GradientSettings {
    colors: [string, string];
    direction: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
}

interface ColorSettingsProps {
    isSolid: boolean;
    isGradient: boolean;
    color: string;
    gradient?: GradientSettings;
    onTypeChange: (type: 'solid' | 'gradient') => void;
    onColorChange: (color: string) => void;
    onGradientColorChange: (index: 0 | 1, color: string) => void;
    onDirectionChange: (dir: GradientSettings['direction']) => void;
}

export const ColorSettings = ({
    isSolid,
    isGradient,
    color,
    gradient,
    onTypeChange,
    onColorChange,
    onGradientColorChange,
    onDirectionChange
}: ColorSettingsProps) => {
    // Gradient State: Which color are we editing? 0 or 1
    const [activeGradientIndex, setActiveGradientIndex] = useState<0 | 1>(0);

    // Ensuring gradient defaults if undefined for safe rendering
    const safeGradient = gradient || { colors: ['#ffffff', '#000000'] as [string, string], direction: 'S' as const };

    // Determine current active color for editing
    const activeColorValue = isSolid ? color : safeGradient.colors[activeGradientIndex];

    const handleColorUpdate = (newColor: string) => {
        if (isSolid) {
            onColorChange(newColor);
        } else {
            onGradientColorChange(activeGradientIndex, newColor);
        }
    };

    return (
        <div className="p-4 bg-surface-overlay rounded-lg border border-border space-y-4 text-text-highlighted shadow-xl">
            {/* Toggle */}
            <MultiToggle
                options={[
                    { value: 'solid', label: 'Solid' },
                    { value: 'gradient', label: 'Gradient' }
                ]}
                value={isSolid ? 'solid' : 'gradient'}
                onChange={onTypeChange}
            />

            {/* Gradient Selector (Only if Gradient) */}
            {isGradient && (
                <div className="flex gap-4 justify-center py-2">
                    {safeGradient.colors.map((c, i) => (
                        <div
                            key={i}
                            onClick={() => setActiveGradientIndex(i as 0 | 1)}
                            className={`cursor-pointer flex flex-col items-center gap-2`}
                        >
                            <div
                                className={`w-10 h-10 rounded-full border-2 shadow-sm transition-all ${activeGradientIndex === i
                                    ? 'border-ring ring-2 ring-ring/30 scale-110'
                                    : 'border-border hover:border-border-hover'}`}
                                style={{ backgroundColor: c }}
                            />
                            <span className={`text-[10px] font-bold transition-colors ${activeGradientIndex === i ? 'text-text-primary' : 'text-text-main'}`}>
                                {i === 0 ? 'Start' : 'End'}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Color Palette */}
            <div className="space-y-2">
                <div className="text-[10px] text-text-main font-semibold">Palette</div>
                <div className="grid grid-cols-7 gap-1.5">
                    {PRESET_COLORS.map(c => (
                        <button
                            key={c}
                            onClick={() => handleColorUpdate(c)}
                            className="w-6 h-6 rounded-full border border-border hover:border-border-selected focus:outline-none focus:ring-1 focus:ring-ring/50 transition-transform hover:scale-110"
                            style={{ backgroundColor: c }}
                            title={c}
                        />
                    ))}
                </div>
            </div>

            {/* Embedded Picker */}
            <div className="flex justify-center py-2">
                <HexColorPicker
                    color={activeColorValue}
                    onChange={handleColorUpdate}
                    style={{ width: '100%', height: '150px' }}
                />
            </div>

            {/* Hex Input */}
            <div className="space-y-1">
                <div className="text-[10px] text-text-main font-semibold">Hex Color</div>
                <div className="flex bg-surface border border-border rounded px-2 py-1.5 items-center gap-2">
                    <span className="text-text-main mr-2 select-none">#</span>
                    <input
                        type="text"
                        value={activeColorValue.replace('#', '')}
                        onChange={(e) => handleColorUpdate(`#${e.target.value}`)}
                        className="bg-transparent border-none outline-none text-xs font-mono text-text-highlighted w-full"
                        maxLength={6}
                    />
                    <div className="w-4 h-4 rounded border border-border" style={{ backgroundColor: activeColorValue }} />
                </div>
            </div>

            {/* Direction Compass (Only if Gradient) */}
            {isGradient && (
                <div className="border-t border-border pt-4 mt-2">
                    <div className="flex flex-col gap-2 items-center">
                        <label className="text-[10px] text-text-main font-semibold">Direction</label>
                        <div className="relative w-32 h-32 flex items-center justify-center bg-surface rounded-full border border-border shadow-inner mt-2">
                            {/* Center Dot */}
                            <div className="absolute w-2 h-2 bg-text-main rounded-full z-10" />

                            {GRADIENT_DIRECTIONS.filter(d => !!d).map((dir) => {
                                const isSelected = safeGradient.direction === dir;
                                // Map direction to rotation angle for visual placement
                                // Standard Compass: N=0 (Up). But in CSS default is right? 
                                // Let's use standard CSS absolute positioning with transforms.

                                // Order in array: 'NW', 'N', 'NE', 'W', '', 'E', 'SW', 'S', 'SE'
                                // We need to map these to degrees:
                                const angleMap: Record<string, number> = {
                                    'N': -90, 'NE': -45, 'E': 0, 'SE': 45,
                                    'S': 90, 'SW': 135, 'W': 180, 'NW': 225
                                };
                                const angle = angleMap[dir];

                                // Calculate position on circle
                                // Radius = 40px?
                                const radius = 42;
                                const rad = (angle * Math.PI) / 180;
                                const x = Math.cos(rad) * radius;
                                const y = Math.sin(rad) * radius;

                                return (
                                    <button
                                        key={dir}
                                        onClick={() => handleDirectionClick(dir)}
                                        className={`absolute w-8 h-8 rounded-full flex items-center justify-center transition-all transform hover:scale-110 ${isSelected
                                            ? 'bg-primary text-primary-fg shadow-primary/50 shadow-md z-20'
                                            : 'text-text-main hover:text-text-highlighted hover:bg-surface-elevated'}`}
                                        style={{
                                            transform: `translate(${x}px, ${y}px)`,
                                        }}
                                        title={dir}
                                    >
                                        {/* Arrow Icon rotated to point outward (or inward? usually outward or just directional) 
                                             Let's point OUT from center.
                                             Base arrow points RIGHT. So rotation = angle.
                                         */}
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            style={{ transform: `rotate(${angle}deg)` }}
                                        >
                                            <path d="M5 12h14" />
                                            <path d="m12 5 7 7-7 7" />
                                        </svg>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    function handleDirectionClick(dir: string) {
        if (dir) onDirectionChange(dir as any);
    }
};
