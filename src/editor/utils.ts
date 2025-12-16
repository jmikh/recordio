import type { Segment } from "./store";

export function virtualToSourceTime(virtualTime: number, segments: Segment[]): number | null {
    let currentVirtual = 0;
    for (const seg of segments) {
        const duration = seg.sourceEnd - seg.sourceStart;
        if (virtualTime >= currentVirtual && virtualTime < currentVirtual + duration) {
            const offset = virtualTime - currentVirtual;
            return seg.sourceStart + offset;
        }
        currentVirtual += duration;
    }
    // If exact end or beyond, cap to end of last segment
    if (segments.length > 0 && virtualTime >= currentVirtual) {
        return segments[segments.length - 1].sourceEnd;
    }
    return null;
}

export function sourceToVirtualTime(sourceTime: number, segments: Segment[]): number {
    let currentVirtual = 0;
    for (const seg of segments) {
        if (sourceTime >= seg.sourceStart && sourceTime <= seg.sourceEnd) {
            return currentVirtual + (sourceTime - seg.sourceStart);
        }
        currentVirtual += (seg.sourceEnd - seg.sourceStart);
    }
    return 0; // Fallback
}

export function getTotalDuration(segments: Segment[]): number {
    return segments.reduce((acc, seg) => acc + (seg.sourceEnd - seg.sourceStart), 0);
}
