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
        <div className="p-4  rounded-lg  space-y-4 text-text-highlighted shadow-xl">
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
                <div className="flex gap-6 justify-center py-2 items-start">
                    {/* Start Color */}
                    <div
                        onClick={() => setActiveGradientIndex(0)}
                        className="cursor-pointer flex flex-col items-center gap-2"
                    >
                        <div
                            className={`w-10 h-10 rounded-full border-2 shadow-sm transition-all ${activeGradientIndex === 0
                                ? 'border-ring ring-2 ring-ring/30 scale-110'
                                : 'border-border hover:border-border-hover'}`}
                            style={{ backgroundColor: safeGradient.colors[0] }}
                        />
                        <span className={`text-[10px] font-bold transition-colors ${activeGradientIndex === 0 ? 'text-text-primary' : 'text-text-main'}`}>
                            Start
                        </span>
                    </div>

                    {/* End Color */}
                    <div
                        onClick={() => setActiveGradientIndex(1)}
                        className="cursor-pointer flex flex-col items-center gap-2"
                    >
                        <div
                            className={`w-10 h-10 rounded-full border-2 shadow-sm transition-all ${activeGradientIndex === 1
                                ? 'border-ring ring-2 ring-ring/30 scale-110'
                                : 'border-border hover:border-border-hover'}`}
                            style={{ backgroundColor: safeGradient.colors[1] }}
                        />
                        <span className={`text-[10px] font-bold transition-colors ${activeGradientIndex === 1 ? 'text-text-primary' : 'text-text-main'}`}>
                            End
                        </span>
                    </div>

                    {/* Direction Circle */}
                    <div className="flex flex-col items-center gap-2">
                        <div className="relative w-10 h-10 flex items-center justify-center">
                            {/* Outer ring with border matching Start/End circles */}
                            <div className="absolute inset-0 rounded-full border-2 border-border bg-surface shadow-sm" />

                            {/* Direction dots on perimeter - sitting on the border */}
                            {GRADIENT_DIRECTIONS.filter(d => !!d).map((dir) => {
                                const isSelected = safeGradient.direction === dir;
                                const angleMap: Record<string, number> = {
                                    'N': -90, 'NE': -45, 'E': 0, 'SE': 45,
                                    'S': 90, 'SW': 135, 'W': 180, 'NW': -135
                                };
                                const angle = angleMap[dir];
                                const radius = 20; // Exactly on the 40px circle's border (half of 40px)
                                const rad = (angle * Math.PI) / 180;
                                const x = Math.cos(rad) * radius;
                                const y = Math.sin(rad) * radius;

                                return (
                                    <button
                                        key={dir}
                                        onClick={() => handleDirectionClick(dir)}
                                        className={`absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full transition-all z-10 
                                            hover:w-4 hover:h-4 hover:-ml-2 hover:-mt-2
                                            ${isSelected
                                                ? 'bg-primary shadow-sm'
                                                : 'bg-text-muted hover:bg-text-main'
                                            }`}
                                        style={{
                                            left: '50%',
                                            top: '50%',
                                            marginLeft: `${x - 6}px`,
                                            marginTop: `${y - 6}px`,
                                        }}
                                        title={dir}
                                    />
                                );
                            })}

                            {/* Center arrow showing selected direction */}
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-primary z-20 relative"
                                style={{
                                    transform: `rotate(${{ 'N': -90, 'NE': -45, 'E': 0, 'SE': 45, 'S': 90, 'SW': 135, 'W': 180, 'NW': -135 }[safeGradient.direction]
                                        }deg)`
                                }}
                            >
                                <path d="M5 12h14" />
                                <path d="m12 5 7 7-7 7" />
                            </svg>
                        </div>
                        <span className="text-[10px] font-bold text-text-main">
                            Direction
                        </span>
                    </div>
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


        </div>
    );

    function handleDirectionClick(dir: string) {
        if (dir) onDirectionChange(dir as any);
    }
};
