import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useProjectStore, useProjectName } from '../../stores/useProjectStore';

const PLACEHOLDER = 'Untitled Project';
/** Horizontal padding (px-2) + caret slack, so the field hugs the measured text */
const CHROME_WIDTH = 18;
const MIN_WIDTH = 60;
const MAX_WIDTH = 240;

/**
 * Project name in the editor header.
 *
 * Reads as plain text (same look as the dashboard project card title) in both
 * states — no box, no border, just the colour ladder from interactive-ghost.
 * Clicking selects the whole name so typing replaces it.
 * The input stays mounted in both states so it keeps a stable accessible
 * handle (`#project-name-input`) for e2e.
 */
export const ProjectNameField = () => {
    const projectName = useProjectName();
    const updateProjectName = useProjectStore(s => s.updateProjectName);

    const [localName, setLocalName] = useState(projectName);
    const [isEditing, setIsEditing] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const measureRef = useRef<HTMLSpanElement>(null);
    /** Escape blurs the input — tells the blur handler to discard the edit */
    const cancelRef = useRef(false);
    const [width, setWidth] = useState(MIN_WIDTH);

    // Sync local state when store name changes externally (e.g. project load)
    useEffect(() => { setLocalName(projectName); }, [projectName]);

    // Size the field to its text — a fixed-width box reads as an input.
    // Layout effect so the box never paints at the wrong width first.
    useLayoutEffect(() => {
        const measured = measureRef.current?.offsetWidth ?? 0;
        setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, measured + CHROME_WIDTH)));
    }, [localName]);

    // Clicking must select the whole name, so suppress the caret placement
    // the browser would do on mousedown and focus it ourselves
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
        if (isEditing) return;
        e.preventDefault();
        inputRef.current?.focus();
    }, [isEditing]);

    const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
        setIsEditing(true);
        e.currentTarget.select();
    }, []);

    const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
        setIsEditing(false);
        if (cancelRef.current) {
            cancelRef.current = false;
            setLocalName(projectName);
            return;
        }
        // Clearing the field is a reset, not a rename to "" — fall back to the
        // placeholder so what we persist matches what the field shows.
        const next = e.currentTarget.value.trim() || PLACEHOLDER;
        setLocalName(next);
        if (next !== projectName) updateProjectName(next);
    }, [projectName, updateProjectName]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        } else if (e.key === 'Escape') {
            cancelRef.current = true;
            e.currentTarget.blur();
        }
    }, []);

    return (
        <div className="relative flex justify-center w-[240px]">
            <input
                ref={inputRef}
                id="project-name-input"
                type="text"
                aria-label="Project name"
                value={localName}
                style={{ width }}
                onChange={(e) => setLocalName(e.target.value)}
                onMouseDown={handleMouseDown}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                maxLength={40}
                className={`h-9 text-sm px-2 select-text truncate bg-transparent border-none outline-none transition-colors placeholder:text-text-muted ${localName ? 'text-center' : 'text-left'} ${
                    isEditing
                        ? 'text-text-highlighted cursor-text'
                        : 'text-text-main cursor-pointer hover:text-text-highlighted'
                }`}
                placeholder={PLACEHOLDER}
            />
            {/* Off-screen twin: measures the text at the input's own typography */}
            <span
                ref={measureRef}
                aria-hidden="true"
                className="absolute left-0 top-0 invisible whitespace-pre text-sm pointer-events-none"
            >
                {localName || PLACEHOLDER}
            </span>
        </div>
    );
};
