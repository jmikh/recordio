import React, { useEffect, useRef, useState, useCallback } from 'react';

interface TimelineScrollbarProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    className?: string;
    dependency?: any;
    orientation?: 'horizontal' | 'vertical';
}

export const TimelineScrollbar: React.FC<TimelineScrollbarProps> = ({ containerRef, className, dependency, orientation = 'horizontal' }) => {
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

        const isHorizontal = orientation === 'horizontal';

        const scrollPos = isHorizontal ? container.scrollLeft : container.scrollTop;
        const scrollSize = isHorizontal ? container.scrollWidth : container.scrollHeight;
        const clientSize = isHorizontal ? container.clientWidth : container.clientHeight;
        const trackSize = isHorizontal ? track.clientWidth : track.clientHeight;

        // Calculate thumb size
        let newThumbSize = (clientSize / scrollSize) * trackSize;
        // Min size for usability
        newThumbSize = Math.max(newThumbSize, 40);
        // If content fits, thumb is full size
        if (scrollSize <= clientSize) {
            newThumbSize = trackSize;
        }

        setThumbWidth(newThumbSize);

        // Calculate thumb position
        const maxThumbPos = trackSize - newThumbSize;
        const maxScrollPos = scrollSize - clientSize;

        if (maxScrollPos > 0) {
            const ratio = scrollPos / maxScrollPos;
            setThumbLeft(ratio * maxThumbPos);
        } else {
            setThumbLeft(0);
        }
    }, [containerRef, orientation]);

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
        const isHorizontal = orientation === 'horizontal';
        startXRef.current = isHorizontal ? e.clientX : e.clientY;
        startScrollLeftRef.current = isHorizontal ? container.scrollLeft : container.scrollTop;

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        const container = containerRef.current;
        const track = trackRef.current;
        if (!container || !track) return;

        const isHorizontal = orientation === 'horizontal';
        const delta = isHorizontal ? e.clientX - startXRef.current : e.clientY - startXRef.current;
        const trackSize = isHorizontal ? track.clientWidth : track.clientHeight;
        const scrollSize = isHorizontal ? container.scrollWidth : container.scrollHeight;
        const clientSize = isHorizontal ? container.clientWidth : container.clientHeight;

        const currentThumbSize = isHorizontal ? thumbRef.current?.clientWidth || 0 : thumbRef.current?.clientHeight || 0;
        const maxThumbMove = trackSize - currentThumbSize;
        const maxScroll = scrollSize - clientSize;

        if (maxThumbMove > 0) {
            const scrollDelta = (delta / maxThumbMove) * maxScroll;
            if (isHorizontal) {
                container.scrollLeft = startScrollLeftRef.current + scrollDelta;
            } else {
                container.scrollTop = startScrollLeftRef.current + scrollDelta;
            }
        }

    }, [containerRef, orientation]);

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

    const isHorizontal = orientation === 'horizontal';
    const isScrollable = isHorizontal
        ? thumbWidth !== trackRef.current?.clientWidth
        : thumbWidth !== trackRef.current?.clientHeight;

    return (
        <div
            className={`${isHorizontal ? 'h-3 w-full' : 'w-3 h-full'} bg-surface ${isHorizontal ? 'border-b' : 'border-l'} border-border relative flex items-center shrink-0 ${className || ''}`}
            ref={trackRef}
        >
            <div
                ref={thumbRef}
                className={`${isHorizontal ? 'h-1.5' : 'w-1.5'} rounded-full absolute transition-colors duration-150 ${isDragging ? 'bg-primary' : 'bg-surface-elevated hover:bg-primary/50'}`}
                style={{
                    ...(isHorizontal ? {
                        width: thumbWidth,
                        left: thumbLeft,
                        height: '6px'
                    } : {
                        height: thumbWidth,
                        top: thumbLeft,
                        width: '6px'
                    }),
                    display: isScrollable ? 'block' : 'none'
                }}
                onMouseDown={handleMouseDown}
            />
        </div>
    );
};
