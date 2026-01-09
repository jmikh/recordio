import React, { useEffect, useRef, useState, useCallback } from 'react';

interface TimelineScrollbarProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    className?: string;
    dependency?: any;
}

export const TimelineScrollbar: React.FC<TimelineScrollbarProps> = ({ containerRef, className, dependency }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);
    const [thumbWidth, setThumbWidth] = useState(0);
    const [thumbLeft, setThumbLeft] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const startXRef = useRef(0);
    const startScrollLeftRef = useRef(0);

    // Sync scrollbar with container scroll
    const updateScrollbar = useCallback(() => {
        const container = containerRef.current;
        const track = trackRef.current;
        if (!container || !track) return;

        const { scrollLeft, scrollWidth, clientWidth } = container;
        const trackWidth = track.clientWidth;

        // Calculate thumb width
        // thumbWidth / trackWidth = clientWidth / scrollWidth
        let newThumbWidth = (clientWidth / scrollWidth) * trackWidth;
        // Min width for usability
        newThumbWidth = Math.max(newThumbWidth, 40);
        // If content fits, thumb is full width (or hidden? user usually expects hidden if no scroll, or full width)
        if (scrollWidth <= clientWidth) {
            newThumbWidth = trackWidth;
        }

        setThumbWidth(newThumbWidth);

        // Calculate thumb position
        // thumbLeft / (trackWidth - thumbWidth) = scrollLeft / (scrollWidth - clientWidth)
        const maxThumbLeft = trackWidth - newThumbWidth;
        const maxScrollLeft = scrollWidth - clientWidth;

        if (maxScrollLeft > 0) {
            const ratio = scrollLeft / maxScrollLeft;
            setThumbLeft(ratio * maxThumbLeft);
        } else {
            setThumbLeft(0);
        }
    }, [containerRef]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Listen to scroll events
        container.addEventListener('scroll', updateScrollbar);

        // Listen to resize to update dimensions
        const observer = new ResizeObserver(updateScrollbar);
        observer.observe(container);

        // Initial update
        updateScrollbar();

        return () => {
            container.removeEventListener('scroll', updateScrollbar);
            observer.disconnect();
        };
    }, [containerRef, updateScrollbar, dependency]);

    // Handle Dragging
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;

        setIsDragging(true);
        startXRef.current = e.clientX;
        startScrollLeftRef.current = container.scrollLeft;

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        const container = containerRef.current;
        const track = trackRef.current;
        if (!container || !track) return;

        const deltaX = e.clientX - startXRef.current;
        const trackWidth = track.clientWidth;
        const { scrollWidth, clientWidth } = container;

        // Calculate how much 1px of thumb moves the scroll
        // ratio = scrollWidth / trackWidth (approx)
        // More precise: 
        // maxThumbMove = trackWidth - thumbWidth
        // maxScroll = scrollWidth - clientWidth
        // scrollDelta = (deltaX / maxThumbMove) * maxScroll

        // We can't rely on state here as it might be stale? 
        // Actually we need the *current* thumbWidth which is in state. 
        // Using refs for width would be safer but let's try rects.

        const currentThumbWidth = thumbRef.current?.clientWidth || 0;
        const maxThumbMove = trackWidth - currentThumbWidth;
        const maxScroll = scrollWidth - clientWidth;

        if (maxThumbMove > 0) {
            const scrollDelta = (deltaX / maxThumbMove) * maxScroll;
            container.scrollLeft = startScrollLeftRef.current + scrollDelta;
        }

    }, [containerRef]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }, [handleMouseMove]);

    // If no scroll needed, render nothing or empty track?
    // User wants "on theme scroll bar". Probably should be visible but disabled if no scroll, or hidden.
    // Usually hidden is better.
    // Let's check if scrollable from state?
    // We can hide it if thumbWidth == trackWidth (approx)
    // But for now let's just render.

    return (
        <div
            className={`h-3 w-full bg-surface border-b border-border relative flex items-center shrink-0 ${className || ''}`}
            ref={trackRef}
        >
            <div
                ref={thumbRef}
                className={`h-1.5 rounded-full absolute transition-colors duration-150 ${isDragging ? 'bg-primary' : 'bg-surface-elevated hover:bg-primary/50'}`}
                style={{
                    width: thumbWidth,
                    left: thumbLeft,
                    // If thumb covers full width, maybe lower opacity or hide?
                    display: thumbWidth === trackRef.current?.clientWidth ? 'none' : 'block'
                }}
                onMouseDown={handleMouseDown}
            />
        </div>
    );
};
