/**
 * Editor-header form of ImpersonationBanner
 * (plans/admin-user-impersonation-oneshot.md): a bottom bar would cover
 * the timeline, so the editors show this icon instead. It's tinted
 * destructive so "you are someone else, read-only" stays visible while
 * closed; the popover carries the same message and Clone/Exit actions.
 */
import { useEffect, useRef, useState } from 'react';
import { LuCopy, LuVenetianMask } from 'react-icons/lu';
import { Button } from '@shared/components';
import { useImpersonationControls } from './useImpersonationControls';

export function ImpersonationHeaderButton() {
    const { who, canClone, cloning, clone, exit } = useImpersonationControls();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    // TEMP debug: exit-only-closes-popup
    useEffect(() => {
        console.log('[ImpersonationHeaderButton] mounted');
        return () => console.log('[ImpersonationHeaderButton] unmounted');
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        const onMouseDown = (event: MouseEvent) => {
            // TEMP debug: exit-only-closes-popup
            const el = event.target as HTMLElement;
            console.log('[ImpersonationHeaderButton] mousedown', {
                inside: containerRef.current?.contains(el),
                tag: el?.tagName, id: el?.id, cls: el?.className,
                atPoint: document.elementFromPoint(event.clientX, event.clientY),
            });
            if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen]);

    if (!who) return null;

    return (
        <div className="relative" ref={containerRef}>
            <Button
                variant="ghost"
                icon={LuVenetianMask}
                onClick={() => setIsOpen(open => !open)}
                aria-label={`Viewing as ${who}`}
                aria-expanded={isOpen}
                title={`Viewing as ${who} — read-only`}
                className="text-destructive bg-destructive/10"
            />

            {isOpen && (
                <div
                    role="dialog"
                    aria-label="Viewing as another user"
                    className="absolute right-0 top-full mt-2 w-72 bg-surface-raised border border-destructive/30 rounded-[var(--radius-lg)] shadow-float z-[var(--z-index-dropdown)] p-4 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-100 origin-top-right"
                >
                    <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-eyebrow text-destructive">Viewing as</span>
                        <span className="text-sm font-bold text-text-highlighted truncate">{who}</span>
                        <span className="text-label">Read-only — nothing you do is saved.</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {canClone && (
                            <Button variant="base" icon={LuCopy} disabled={cloning} onClick={clone} className="flex-1">
                                {cloning ? 'Cloning…' : 'Clone'}
                            </Button>
                        )}
                        <Button variant="base" onClick={() => { console.log('[ImpersonationHeaderButton] Exit clicked'); exit(); }} className="flex-1">
                            Exit
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
