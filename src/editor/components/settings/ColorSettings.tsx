import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';


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
        <div className="p-4 bg-[#252525] rounded-lg border border-gray-700/50 space-y-4 text-gray-200 shadow-xl">
            {/* Toggle */}
            <div className="flex bg-[#1a1a1a] p-1 rounded-lg">
                <button
                    className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${isSolid ? 'bg-gray-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                    onClick={() => onTypeChange('solid')}
                >
                    Solid
                </button>
                <button
                    className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${isGradient ? 'bg-gray-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                    onClick={() => onTypeChange('gradient')}
                >
                    Gradient
                </button>
            </div>

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
                                className={`w-10 h-10 rounded-full border-2 shadow-sm transition-all ${activeGradientIndex === i ? 'border-blue-500 ring-2 ring-blue-500/30 scale-110' : 'border-gray-600 hover:border-gray-400'}`}
                                style={{ backgroundColor: c }}
                            />
                            <span className={`text-[10px] uppercase font-bold transition-colors ${activeGradientIndex === i ? 'text-blue-400' : 'text-gray-500'}`}>
                                {i === 0 ? 'Start' : 'End'}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Color Palette */}
            <div className="space-y-2">
                <div className="text-[10px] text-gray-500 uppercase font-semibold">Palette</div>
                <div className="grid grid-cols-7 gap-1.5">
                    {PRESET_COLORS.map(c => (
                        <button
                            key={c}
                            onClick={() => handleColorUpdate(c)}
                            className="w-6 h-6 rounded-full border border-gray-600/30 hover:border-white focus:outline-none focus:ring-1 focus:ring-white/50 transition-transform hover:scale-110"
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
                <div className="text-[10px] text-gray-500 uppercase font-semibold">Hex Color</div>
                <div className="flex bg-[#1a1a1a] border border-gray-700 rounded px-2 py-1.5 items-center gap-2">
                    <span className="text-gray-500 mr-2 select-none">#</span>
                    <input
                        type="text"
                        value={activeColorValue.replace('#', '')}
                        onChange={(e) => handleColorUpdate(`#${e.target.value}`)}
                        className="bg-transparent border-none outline-none text-xs font-mono text-gray-200 w-full uppercase"
                        maxLength={6}
                    />
                    <div className="w-4 h-4 rounded border border-gray-600" style={{ backgroundColor: activeColorValue }} />
                </div>
            </div>

            {/* Direction Compass (Only if Gradient) */}
            {isGradient && (
                <div className="border-t border-gray-700 pt-4 mt-2">
                    <div className="flex flex-col gap-2 items-center">
                        <label className="text-[10px] text-gray-500 uppercase font-semibold">Direction</label>
                        <div className="relative w-32 h-32 flex items-center justify-center bg-[#1a1a1a] rounded-full border border-gray-700/50 shadow-inner mt-2">
                            {/* Center Dot */}
                            <div className="absolute w-2 h-2 bg-gray-600 rounded-full z-10" />

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
                                            ? 'bg-blue-600 text-white shadow-blue-500/50 shadow-md z-20'
                                            : 'text-gray-500 hover:text-gray-200 hover:bg-[#333]'}`}
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
