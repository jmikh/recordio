import React from 'react';

interface SliderProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
    onPointerDown?: () => void;
    onPointerUp?: () => void;
}

export const Slider: React.FC<SliderProps> = ({
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    className = '',
    onPointerDown,
    onPointerUp
}) => {
    return (
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className={`w-full accent-blue-500 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer hover:accent-blue-400 transition-colors ${className}`}
        />
    );
};
