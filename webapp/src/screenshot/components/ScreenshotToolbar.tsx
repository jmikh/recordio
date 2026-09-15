/**
 * Vertical tool rail. Shortcuts (V T A L R O B C) are wired in
 * useScreenshotShortcuts; the titles advertise them.
 */
import type { ComponentType } from 'react';
import { LuArrowUpRight, LuCircle, LuCrop, LuMinus, LuMousePointer2, LuSquare, LuType } from 'react-icons/lu';
import { TbBlur } from 'react-icons/tb';
import { Button } from '@shared/components';
import { useScreenshotUIStore, type ScreenshotTool } from '../store/useScreenshotUIStore';
import { chooseTool } from '../actions';

interface ToolDef {
    tool: ScreenshotTool;
    label: string;
    key: string;
    icon: ComponentType<{ className?: string }>;
}

const TOOLS: ToolDef[] = [
    { tool: 'select', label: 'Select', key: 'V', icon: LuMousePointer2 },
    { tool: 'text', label: 'Text', key: 'T', icon: LuType },
    { tool: 'arrow', label: 'Arrow', key: 'A', icon: LuArrowUpRight },
    { tool: 'line', label: 'Line', key: 'L', icon: LuMinus },
    { tool: 'rect', label: 'Rectangle', key: 'R', icon: LuSquare },
    { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: LuCircle },
    { tool: 'blur', label: 'Blur', key: 'B', icon: TbBlur },
    { tool: 'crop', label: 'Crop', key: 'C', icon: LuCrop },
];

export function ScreenshotToolbar() {
    const active = useScreenshotUIStore(s => s.tool);

    return (
        <nav aria-label="Tools" className="flex flex-col gap-1 p-2 bg-surface border-r border-border">
            {TOOLS.map(({ tool, label, key, icon }) => (
                <Button
                    key={tool}
                    variant={active === tool ? 'primary' : 'ghost'}
                    icon={icon}
                    aria-label={label}
                    aria-pressed={active === tool}
                    title={`${label} (${key})`}
                    onClick={() => chooseTool(tool)}
                />
            ))}
        </nav>
    );
}
