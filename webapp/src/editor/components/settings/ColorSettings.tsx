import { useState, useRef, useEffect } from 'react';
import { HexColorPicker, HexAlphaColorPicker } from 'react-colorful';
import { MultiToggle } from '@shared/components';
import { usePaletteStore } from '../../stores/usePaletteStore';
import { useHistoryBatcher } from '../../hooks/useHistoryBatcher';

interface GradientSettings {
    colors: [string, string];
    /** Gradient angle in degrees (0-360). 0 = up, 90 = right, 180 = down, 270 = left */
    direction: number;
}

interface ColorSettingsProps {
    isSolid: boolean;
    isGradient: boolean;
    color: string;
    gradient?: GradientSettings;
    onTypeChange: (type: 'solid' | 'gradient') => void;
    onColorChange: (color: string) => void;
    onGradientColorChange: (index: 0 | 1, color: string) => void;
    onDirectionChange: (direction: number) => void;
    /** If true, hides the Solid/Gradient toggle and shows only solid color controls */
    solidOnly?: boolean;
    /** If true, shows an opacity/alpha slider on the color picker */
    showAlpha?: boolean;
}

export const ColorSettings = ({
    isSolid,
    isGradient,
    color,
    gradient,
    onTypeChange,
    onColorChange,
    onGradientColorChange,
    onDirectionChange,
    solidOnly = false,
    showAlpha = false
}: ColorSettingsProps) => {
    // Global palette store
    const { palette, updatePaletteColor, resetPalette } = usePaletteStore();

    // Gradient State: Which color are we editing? 0 or 1
    const [activeGradientIndex, setActiveGradientIndex] = useState<0 | 1>(0);

    // Palette selection state: which palette color is selected (null = none)
    const [selectedPaletteIndex, setSelectedPaletteIndex] = useState<number | null>(null);

    // Ensuring gradient defaults if undefined for safe rendering
    const safeGradient = gradient || { colors: ['#ffffff', '#000000'] as [string, string], direction: 135 };

    // Determine current active color for editing
    // In solidOnly mode, always use the solid color
    const activeColorValue = (isSolid || solidOnly) ? color : safeGradient.colors[activeGradientIndex];

    // Local hex input state — allows typing freely while only propagating valid values
    const isValidHex = (v: string) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
    const [hexInput, setHexInput] = useState(activeColorValue.replace('#', ''));
    // Sync local input when upstream color changes (picker, palette, gradient switch)
    useEffect(() => {
        setHexInput(activeColorValue.replace('#', ''));
    }, [activeColorValue]);

    // Handle color update from picker - updates both active color AND selected palette color
    const handleColorUpdate = (newColor: string) => {
        // Always update the active Start/End color
        // In solidOnly mode, always update solid color
        if (isSolid || solidOnly) {
            onColorChange(newColor);
        } else {
            onGradientColorChange(activeGradientIndex, newColor);
        }

        // If a palette color is selected, also update it in the global store
        if (selectedPaletteIndex !== null) {
            updatePaletteColor(selectedPaletteIndex, newColor);
        }
    };

    // Handle palette color click - toggle selection and copy color
    const handlePaletteClick = (index: number) => {
        if (selectedPaletteIndex === index) {
            // Already selected - deselect
            setSelectedPaletteIndex(null);
        } else {
            // Select this palette color and copy its value to active color
            setSelectedPaletteIndex(index);
            const paletteColor = palette[index];
            if (isSolid || solidOnly) {
                onColorChange(paletteColor);
            } else {
                onGradientColorChange(activeGradientIndex, paletteColor);
            }
        }
    };

    return (
        <div className="p-4  rounded-lg  space-y-4 text-text-highlighted shadow-xl">
            {/* Toggle - hidden in solidOnly mode */}
            {!solidOnly && (
                <MultiToggle
                    options={[
                        { value: 'solid', label: 'Solid' },
                        { value: 'gradient', label: 'Gradient' }
                    ]}
                    value={isSolid ? 'solid' : 'gradient'}
                    onChange={onTypeChange}
                />
            )}

            {/* Gradient Selector (Only if Gradient) */}
            {isGradient && (
                <div className="flex gap-6 justify-center py-2">
                    {/* Start Color */}
                    <div
                        onClick={() => setActiveGradientIndex(0)}
                        className="cursor-pointer flex flex-col items-center gap-2"
                    >
                        {/* Fixed height wrapper to align circle centers (52px = dial outer size) */}
                        <div className="h-[52px] flex items-center justify-center">
                            <div
                                className={`w-10 h-10 rounded-full border shadow-sm transition-all ${activeGradientIndex === 0
                                    ? 'border-ring ring-2 ring-ring/30 scale-110'
                                    : 'border-border hover:border-border-hover'}`}
                                style={{ backgroundColor: safeGradient.colors[0] }}
                            />
                        </div>
                        <span className="text-[10px] font-bold text-text-main">
                            Start
                        </span>
                    </div>

                    {/* Direction Dial - now between Start and End */}
                    <DirectionDial
                        angle={safeGradient.direction}
                        gradient={`linear-gradient(${safeGradient.direction}deg, ${safeGradient.colors[0]} -1%, ${safeGradient.colors[1]} 101%)`}
                        onAngleChange={onDirectionChange}
                    />

                    {/* End Color */}
                    <div
                        onClick={() => setActiveGradientIndex(1)}
                        className="cursor-pointer flex flex-col items-center gap-2"
                    >
                        {/* Fixed height wrapper to align circle centers (52px = dial outer size) */}
                        <div className="h-[52px] flex items-center justify-center">
                            <div
                                className={`w-10 h-10 rounded-full border shadow-sm transition-all ${activeGradientIndex === 1
                                    ? 'border-ring ring-2 ring-ring/30 scale-110'
                                    : 'border-border hover:border-border-hover'}`}
                                style={{ backgroundColor: safeGradient.colors[1] }}
                            />
                        </div>
                        <span className="text-[10px] font-bold text-text-main">
                            End
                        </span>
                    </div>
                </div>
            )}

            {/* Color Palette */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <div className="text-[10px] text-text-main font-semibold">Palette</div>
                    <button
                        onClick={() => {
                            resetPalette();
                            setSelectedPaletteIndex(null);
                        }}
                        className="text-[9px] text-text-muted hover:text-text-main transition-colors"
                        title="Reset palette to defaults"
                    >
                        Reset
                    </button>
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                    {palette.map((c, index) => (
                        <button
                            key={index}
                            onClick={() => handlePaletteClick(index)}
                            className={`w-6 h-6 rounded-full border transition-all
                                ${selectedPaletteIndex === index
                                    ? 'border-border-selected ring-2 ring-border-selected/40 scale-110'
                                    : 'border-border hover:border-border-hover hover:scale-110'
                                }
                                focus:outline-none`}
                            style={{ backgroundColor: c }}
                            title={c}
                        />
                    ))}
                </div>
            </div>

            {/* Embedded Picker */}
            <div className="flex justify-center py-2">
                {showAlpha ? (
                    <HexAlphaColorPicker
                        color={activeColorValue}
                        onChange={handleColorUpdate}
                        style={{ width: '100%', height: '150px' }}
                    />
                ) : (
                    <HexColorPicker
                        color={activeColorValue}
                        onChange={handleColorUpdate}
                        style={{ width: '100%', height: '150px' }}
                    />
                )}
            </div>

            {/* Hex Input */}
            <div className="space-y-1">
                <div className="text-[10px] text-text-main font-semibold">Hex Color</div>
                <div className={`flex bg-surface border rounded px-2 py-1.5 items-center gap-2 ${isValidHex(`#${hexInput}`) ? 'border-border' : 'border-destructive'}`}>
                    <span className="text-text-main mr-2 select-none">#</span>
                    <input
                        type="text"
                        value={hexInput}
                        onChange={(e) => {
                            const raw = e.target.value;
                            setHexInput(raw);
                            const candidate = `#${raw}`;
                            if (isValidHex(candidate)) {
                                handleColorUpdate(candidate);
                            }
                        }}
                        className="bg-transparent border-none outline-none text-xs font-mono text-text-highlighted w-full"
                        maxLength={showAlpha ? 8 : 6}
                    />
                    <div className="w-4 h-4 rounded border border-border" style={{ backgroundColor: activeColorValue }} />
                </div>
                {!isValidHex(`#${hexInput}`) && (
                    <div className="text-[10px] text-destructive">Invalid hex color</div>
                )}
            </div>


        </div>
    );
};

// =============================================
// Direction Dial Component (FloatingHandleDial style)
// =============================================

interface DirectionDialProps {
    angle: number;
    gradient: string;
    onAngleChange: (angle: number) => void;
}

function DirectionDial({ angle, gradient, onAngleChange }: DirectionDialProps) {
    const { startInteraction, endInteraction, batchAction } = useHistoryBatcher();
    const [isDragging, setIsDragging] = useState(false);
    const dialRef = useRef<HTMLDivElement>(null);

    // Inner circle matches Start/End circles (40px = w-10 h-10)
    const innerSize = 40;
    // Outer ring adds space for the handle track
    const outerSize = 52;
    const handleAngleRad = (angle - 90) * (Math.PI / 180);
    const handleRadius = outerSize / 2 - 6;
    const handleX = outerSize / 2 + Math.cos(handleAngleRad) * handleRadius;
    const handleY = outerSize / 2 + Math.sin(handleAngleRad) * handleRadius;

    const updateAngle = (e: MouseEvent | React.MouseEvent) => {
        if (!dialRef.current) return;
        const rect = dialRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const rad = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        let deg = (rad * 180 / Math.PI + 90 + 360) % 360;
        batchAction(() => onAngleChange(Math.round(deg)));
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        startInteraction();
        updateAngle(e);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => isDragging && updateAngle(e);
        const handleMouseUp = () => {
            if (isDragging) {
                setIsDragging(false);
                endInteraction();
            }
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, endInteraction]);

    return (
        <div className="flex flex-col items-center gap-2">
            <div
                ref={dialRef}
                onMouseDown={handleMouseDown}
                className="relative flex items-center justify-center rounded-full border-2 border-border bg-surface shadow-sm"
                style={{
                    width: outerSize,
                    height: outerSize,
                    cursor: isDragging ? 'grabbing' : 'grab',
                    userSelect: 'none',
                }}
            >
                {/* Inner gradient circle */}
                <div
                    className="rounded-full"
                    style={{
                        width: innerSize,
                        height: innerSize,
                        background: gradient,
                    }}
                />

                {/* Handle on outer ring */}
                <div
                    className="absolute rounded-full bg-white shadow-md transition-transform"
                    style={{
                        width: 10,
                        height: 10,
                        left: handleX - 5,
                        top: handleY - 5,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                    }}
                />
            </div>
            {/* Degree label - same style as Start/End labels */}
            <span className="text-[10px] font-bold text-text-main">
                {angle}°
            </span>
        </div>
    );
}
