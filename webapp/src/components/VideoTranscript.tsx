/**
 * Clickable transcript beside the watch-page player. Lines arrive from
 * shared-video-get already in OUTPUT time, so seeking is a direct
 * `currentTime` set — no time mapping happens on this side.
 *
 * The line containing the playhead is highlighted and kept in view
 * (scrolling only the list, never the page, and never while the viewer
 * is hovering the list — they're reading it).
 *
 * Chrome-less on purpose: the watch page's side panel owns the border,
 * background and the "Transcript" heading, so this is just the list and
 * fills whatever slot it is given.
 */
import { useEffect, useRef } from 'react';
import { Button } from '@shared/components';
import type { SharedVideoCaption } from '@shared/api';
import { formatTimeCode } from '../editor/utils';

interface VideoTranscriptProps {
    captions: SharedVideoCaption[];
    /** Player position in output ms */
    currentTimeMs: number;
    onSeek: (outputMs: number) => void;
    className?: string;
}

/** Index of the last line that has started — stays lit through gaps between lines. */
function activeLineIndex(captions: SharedVideoCaption[], currentTimeMs: number): number {
    let index = -1;
    for (let i = 0; i < captions.length; i++) {
        if (captions[i].startMs > currentTimeMs) break;
        index = i;
    }
    return index;
}

export function VideoTranscript({ captions, currentTimeMs, onSeek, className = '' }: VideoTranscriptProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const hoveringRef = useRef(false);
    const activeIndex = activeLineIndex(captions, currentTimeMs);

    useEffect(() => {
        const list = listRef.current;
        const line = list?.children[activeIndex] as HTMLElement | undefined;
        if (!list || !line || hoveringRef.current) return;
        // offsetTop is relative to the list (it is position: relative)
        const lineTop = line.offsetTop;
        const lineBottom = lineTop + line.offsetHeight;
        const viewTop = list.scrollTop;
        const viewBottom = viewTop + list.clientHeight;
        if (lineTop >= viewTop && lineBottom <= viewBottom) return;
        list.scrollTo({ top: lineTop - (list.clientHeight - line.offsetHeight) / 2, behavior: 'smooth' });
    }, [activeIndex]);

    return (
        <section
            aria-label="Transcript"
            className={`flex flex-col min-h-0 ${className}`}
        >
            <div
                ref={listRef}
                onPointerEnter={() => { hoveringRef.current = true; }}
                onPointerLeave={() => { hoveringRef.current = false; }}
                className="relative flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 pb-3 flex flex-col gap-0.5 max-h-80 lg:max-h-none"
            >
                {captions.map((caption, i) => {
                    const isActive = i === activeIndex;
                    return (
                        <Button
                            key={`${caption.startMs}-${i}`}
                            variant="ghost"
                            fullWidth
                            aria-current={isActive ? 'true' : undefined}
                            onClick={() => onSeek(caption.startMs)}
                            className={`h-auto justify-start items-start text-left px-2 py-1.5 rounded-[var(--radius-md)] hover:bg-state-hover ${
                                isActive ? 'bg-state-active text-text-highlighted' : ''
                            }`}
                        >
                            <span className="text-label tabular-nums shrink-0 w-11 pt-px">{formatTimeCode(caption.startMs)}</span>
                            <span className="whitespace-normal">{caption.text}</span>
                        </Button>
                    );
                })}
            </div>
        </section>
    );
}
