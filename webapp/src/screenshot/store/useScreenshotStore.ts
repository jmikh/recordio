/**
 * Screenshot document store (plans/screenshots Step 8): the ScreenshotDoc
 * under zundo undo/redo (only `doc` is tracked), the row name outside it,
 * and a 2 s debounced autosave to ScreenshotService. Sibling of the video
 * editor's useProjectStore, minus the timeline.
 */
import { create, useStore } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { temporal, type TemporalState } from 'zundo';
import type { Rect } from '@shared/types';
import type { AnnotationDefaults, ScreenshotDoc } from '@shared/types/screenshot';
import type { OverlayItem } from '@shared/types/overlay';
import { createHistoryBatcher } from '../../editor/hooks/useHistoryBatcher';
import { ScreenshotService } from '../screenshotService';

export type ZOrderMove = 'front' | 'forward' | 'backward' | 'back';

interface ScreenshotState {
    doc: ScreenshotDoc | null;
    /** Row name (not part of the document / history) */
    name: string;

    loadDoc: (doc: ScreenshotDoc, name: string) => void;
    setName: (name: string) => void;
    addAnnotation: (item: OverlayItem) => void;
    updateAnnotation: (id: string, updates: Partial<OverlayItem>) => void;
    removeAnnotation: (id: string) => void;
    moveAnnotation: (id: string, move: ZOrderMove) => void;
    setCrop: (crop: Rect | null) => void;
    updateDefaults: (defaults: Partial<AnnotationDefaults>) => void;
}

const AUTOSAVE_DEBOUNCE_MS = 2000;

function withDoc(state: ScreenshotState, patch: (doc: ScreenshotDoc) => Partial<ScreenshotDoc>): Partial<ScreenshotState> {
    if (!state.doc) return {};
    return { doc: { ...state.doc, ...patch(state.doc) } };
}

export const useScreenshotStore = create<ScreenshotState>()(
    subscribeWithSelector(
        temporal(
            (set) => ({
                doc: null,
                name: '',

                loadDoc: (doc, name) => set({ doc, name }),
                setName: (name) => set({ name }),

                addAnnotation: (item) => set(state => withDoc(state, doc => ({
                    annotations: [...doc.annotations, item],
                }))),

                updateAnnotation: (id, updates) => set(state => withDoc(state, doc => ({
                    annotations: doc.annotations.map(a => (a.id === id ? { ...a, ...updates } as OverlayItem : a)),
                }))),

                removeAnnotation: (id) => set(state => withDoc(state, doc => ({
                    annotations: doc.annotations.filter(a => a.id !== id),
                }))),

                moveAnnotation: (id, move) => set(state => withDoc(state, doc => {
                    const items = [...doc.annotations];
                    const from = items.findIndex(a => a.id === id);
                    if (from === -1) return {};
                    const last = items.length - 1;
                    const to = move === 'front' ? last
                        : move === 'back' ? 0
                            : move === 'forward' ? Math.min(last, from + 1)
                                : Math.max(0, from - 1);
                    if (to === from) return {};
                    const [item] = items.splice(from, 1);
                    items.splice(to, 0, item);
                    return { annotations: items };
                })),

                setCrop: (crop) => set(state => withDoc(state, () => ({ cropPx: crop }))),

                updateDefaults: (defaults) => set(state => withDoc(state, doc => ({
                    annotationDefaults: { ...doc.annotationDefaults, ...defaults },
                }))),
            }),
            {
                partialize: (state) => ({ doc: state.doc }),
                equality: (a, b) => JSON.stringify(a) === JSON.stringify(b),
                limit: 50,
            },
        ),
    ),
);

export const useScreenshotDoc = () => useScreenshotStore(s => s.doc);

export const useScreenshotHistory = <T,>(
    selector: (state: TemporalState<{ doc: ScreenshotDoc | null }>) => T,
) => useStore(useScreenshotStore.temporal, selector);

/** One undo step per drag / slider interaction (see editor/hooks/useHistoryBatcher). */
export const useScreenshotHistoryBatcher = createHistoryBatcher(() => useScreenshotStore.temporal);

/** Replaces the document (load, conflict reload) without leaving a history entry. */
export function replaceScreenshotDoc(doc: ScreenshotDoc, name: string): void {
    useScreenshotStore.getState().loadDoc(doc, name);
    useScreenshotStore.temporal.getState().clear();
}

// --- Auto-save subscription ---
// Debounces document changes; ScreenshotService.saveScreenshot skips no-op
// writes via SHA-256 hash and raises the conflict modal on a CAS loss.
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSave: (() => void) | null = null;

/** Runs a pending debounced save now (editor unmount). */
export function flushScreenshotSave(): void {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    const run = pendingSave;
    pendingSave = null;
    run?.();
}

useScreenshotStore.subscribe(
    (state) => state.doc,
    (doc, previous) => {
        // A load (null → doc, or a different id) is not an edit
        if (!doc || !previous || previous.id !== doc.id) return;
        if (saveTimeout) clearTimeout(saveTimeout);
        pendingSave = () => {
            const current = useScreenshotStore.getState().doc;
            if (!current || current.id !== doc.id) return;
            void ScreenshotService.saveScreenshot(current);
        };
        saveTimeout = setTimeout(() => {
            saveTimeout = null;
            const run = pendingSave;
            pendingSave = null;
            run?.();
        }, AUTOSAVE_DEBOUNCE_MS);
    },
);
