/**
 * Keyboard shortcuts for the screenshot editor: tool letters, Delete,
 * Escape (exit text edit → cancel crop → deselect), Enter (apply crop),
 * ⌘Z / ⇧⌘Z. Ignored while typing in an input or contentEditable.
 */
import { useEffect } from 'react';
import { useScreenshotStore } from './store/useScreenshotStore';
import { useScreenshotUIStore, type ScreenshotTool } from './store/useScreenshotUIStore';
import { applyCrop, cancelCrop, chooseTool, deleteSelected } from './actions';

const TOOL_KEYS: Record<string, ScreenshotTool> = {
    v: 'select', t: 'text', a: 'arrow', l: 'line', r: 'rect', o: 'ellipse', b: 'blur', c: 'crop',
};

function isTypingTarget(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

export function useScreenshotShortcuts(): void {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (isTypingTarget()) return;
            const ui = useScreenshotUIStore.getState();
            const meta = e.metaKey || e.ctrlKey;

            if (meta && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                const temporal = useScreenshotStore.temporal.getState();
                if (e.shiftKey) temporal.redo(); else temporal.undo();
                return;
            }
            if (meta || e.altKey) return;

            switch (e.key) {
                case 'Delete':
                case 'Backspace':
                    if (ui.selectedId) {
                        e.preventDefault();
                        deleteSelected();
                    }
                    return;
                case 'Escape':
                    e.preventDefault();
                    if (ui.isEditingText) ui.exitTextEdit();
                    else if (ui.tool === 'crop') cancelCrop();
                    else if (ui.selectedId) ui.select(null);
                    else ui.setTool('select');
                    return;
                case 'Enter':
                    if (ui.tool === 'crop') {
                        e.preventDefault();
                        applyCrop();
                    }
                    return;
            }

            const tool = TOOL_KEYS[e.key.toLowerCase()];
            if (tool) {
                e.preventDefault();
                chooseTool(tool);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}
