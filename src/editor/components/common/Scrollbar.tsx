import React, { useEffect, useRef, useState, useCallback } from 'react';

interface ScrollbarProps {
    container: HTMLElement | null;
    className?: string;
    dependency?: any;
    orientation?: 'horizontal' | 'vertical';
}

export const Scrollbar: React.FC<ScrollbarProps> = ({ container, className, dependency, orientation = 'horizontal' }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);
    const [thumbWidth, setThumbWidth] = useState(0);
    const [thumbLeft, setThumbLeft] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const startXRef = useRef(0);
    const startScrollLeftRef = useRef(0);

    // Sync scrollbar with container scroll
    const updateScrollbar = useCallback(() => {
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
    }, [container, orientation]);

    useEffect(() => {
        if (!container) return;

        // Listen to scroll events
        container.addEventListener('scroll', updateScrollbar);

        // Listen to resize to update dimensions
        const observer = new ResizeObserver(updateScrollbar);
        observer.observe(container);
        // Also observe children to detect content height changes
        Array.from(container.children).forEach(child => observer.observe(child));

        // Initial update
        updateScrollbar();

        return () => {
            container.removeEventListener('scroll', updateScrollbar);
            observer.disconnect();
        };
    }, [container, updateScrollbar, dependency]);

    // Handle Dragging
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        if (!container) return;

        setIsDragging(true);
        const isHorizontal = orientation === 'horizontal';
        startXRef.current = isHorizontal ? e.clientX : e.clientY;
        startScrollLeftRef.current = isHorizontal ? container.scrollLeft : container.scrollTop;

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
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

    }, [container, orientation]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }, [handleMouseMove]);

    // If no scroll needed, render nothing or empty track?
    // User wants "on theme scroll bar". Probably should be visible but disabled if no scroll, or hidden.
    // Usually hidden is better.

    const isHorizontal = orientation === 'horizontal';
    const isScrollable = isHorizontal
        ? thumbWidth !== trackRef.current?.clientWidth
        : thumbWidth !== trackRef.current?.clientHeight;

    // We use visibility: hidden instead of display: none so we can still measure track dimensions if needed
    // although if hidden, user can't interact.
    // If not scrollable, we hide the whole track.

    if (!isScrollable && !isDragging) { // Keep visible if dragging to prevent glitch
        // Actually if not scrollable, you can't be dragging? 
        // dragging implies thumb exists.
        // But safe to check.
    }

    const isVisible = isScrollable || isDragging;

    return (
        <div
            className={`${isHorizontal ? 'h-3 w-full flex-row border-b' : 'w-3 h-full flex-col border-l'} bg-surface border-border relative flex items-center shrink-0 ${className || ''}`}
            ref={trackRef}
            style={{
                visibility: isVisible ? 'visible' : 'hidden',
                opacity: isVisible ? 1 : 0,
                transition: 'opacity 0.2s'
            }}
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
                    })
                }}
                onMouseDown={handleMouseDown}
            />
        </div>
    );
};
