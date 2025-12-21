import { useMemo } from 'react';
import type { UserEvent, Size } from '../core/types';
import { findHoverBlocks } from '../core/effects/viewportMotion';

interface HoverInspectorProps {
    events: UserEvent[];
    inputSize: Size | null;
}

export function HoverInspector({ events, inputSize }: HoverInspectorProps) {
    const blocks = useMemo(() => {
        if (!inputSize || events.length === 0) return [];
        return findHoverBlocks(events, inputSize);
    }, [events, inputSize]);

    return (
        <div className="flex-1 flex flex-col overflow-hidden border-b border-[#333]">
            <div className="p-2 bg-[#333] text-white flex justify-between items-center">
                <span className="font-bold">Hover Inspector ({blocks.length})</span>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-2">
                {blocks.length === 0 && <div className="text-gray-500 italic p-2">No hover blocks detected.</div>}

                {blocks.map((block, i) => {
                    const duration = ((block.endTime - block.startTime) / 1000).toFixed(1);
                    return (
                        <div key={i} className="bg-[#1e1e1e] p-2 rounded border border-[#333] hover:border-green-500 cursor-pointer transition-colors">
                            <div className="flex justify-between text-white font-mono mb-1 items-center">
                                <span className="font-bold text-green-400">Block #{i}</span>
                                <span className="text-gray-500">{duration}s</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-gray-400">
                                <div>Start: <span className="text-gray-300">{block.startTime}</span></div>
                                <div>End: <span className="text-gray-300">{block.endTime}</span></div>
                                <div>CX: <span className="text-gray-300">{Math.round(block.centerX)}</span></div>
                                <div>CY: <span className="text-gray-300">{Math.round(block.centerY)}</span></div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
