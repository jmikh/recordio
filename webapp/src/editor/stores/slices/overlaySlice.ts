import type { StateCreator } from 'zustand';
import type { ProjectState } from '../useProjectStore';
import type { ID } from '../../../types';
import type { OverlayBlock, OverlayItem } from '../../../types/overlay';
import { recomputeOutputTimes } from '../../../core/mappers/timeMapper';
import { getTimeMapper } from '../../hooks/useTimeMapper';

export interface OverlaySlice {
    addOverlayBlock: (block: OverlayBlock) => void;
    updateOverlayBlock: (id: ID, updates: Partial<Pick<OverlayBlock, 'sourceStartTimeMs' | 'sourceEndTimeMs'>>) => void;
    deleteOverlayBlock: (id: ID) => void;
    clearOverlayBlocks: () => void;
    addOverlayItem: (blockId: ID, item: OverlayItem) => void;
    updateOverlayItem: (blockId: ID, itemId: ID, updates: Partial<OverlayItem>) => void;
    deleteOverlayItem: (blockId: ID, itemId: ID) => void;
    toggleOverlayEnabled: () => void;
}

export const createOverlaySlice: StateCreator<ProjectState, [["zustand/subscribeWithSelector", never], ["temporal", unknown]], [], OverlaySlice> = (set, _get, store) => ({

    addOverlayBlock: (block) => {
        set(state => {
            const overlayBlocks = [...state.project.timeline.overlayBlocks, block]
                .sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(overlayBlocks, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        overlayBlocks: stamped as OverlayBlock[]
                    }
                }
            };
        });
    },

    updateOverlayBlock: (id, updates) => {
        set(state => {
            const overlayBlocks = state.project.timeline.overlayBlocks;
            const idx = overlayBlocks.findIndex(b => b.id === id);
            if (idx === -1) return state;

            const nextBlocks = [...overlayBlocks];
            nextBlocks[idx] = { ...nextBlocks[idx], ...updates };

            nextBlocks.sort((a, b) => a.sourceStartTimeMs - b.sourceStartTimeMs);

            const timeMapper = getTimeMapper(state.project.timeline.outputWindows);
            const stamped = recomputeOutputTimes(nextBlocks, timeMapper);

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        overlayBlocks: stamped as OverlayBlock[]
                    }
                }
            };
        });
    },

    deleteOverlayBlock: (id) => {
        set(state => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    overlayBlocks: state.project.timeline.overlayBlocks.filter(b => b.id !== id)
                }
            }
        }));
    },

    clearOverlayBlocks: () => {
        set(state => ({
            project: {
                ...state.project,
                timeline: {
                    ...state.project.timeline,
                    overlayBlocks: []
                }
            }
        }));
    },

    addOverlayItem: (blockId, item) => {
        set(state => {
            const overlayBlocks = state.project.timeline.overlayBlocks;
            const idx = overlayBlocks.findIndex(b => b.id === blockId);
            if (idx === -1) return state;

            // Draw order priority: blur first, then text, border, arrow last
            const TYPE_ORDER: Record<string, number> = { blur: 0, text: 1, border: 2, arrow: 3 };
            const newItems = [...overlayBlocks[idx].items, item]
                .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));

            const nextBlocks = [...overlayBlocks];
            nextBlocks[idx] = { ...nextBlocks[idx], items: newItems };

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        overlayBlocks: nextBlocks
                    }
                }
            };
        });
    },

    updateOverlayItem: (blockId, itemId, updates) => {
        set(state => {
            const overlayBlocks = state.project.timeline.overlayBlocks;
            const blockIdx = overlayBlocks.findIndex(b => b.id === blockId);
            if (blockIdx === -1) return state;

            const block = overlayBlocks[blockIdx];
            const itemIdx = block.items.findIndex(i => i.id === itemId);
            if (itemIdx === -1) return state;

            const nextItems = [...block.items];
            nextItems[itemIdx] = { ...nextItems[itemIdx], ...updates } as OverlayItem;

            const nextBlocks = [...overlayBlocks];
            nextBlocks[blockIdx] = { ...block, items: nextItems };

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        overlayBlocks: nextBlocks
                    }
                }
            };
        });
    },

    deleteOverlayItem: (blockId, itemId) => {
        set(state => {
            const overlayBlocks = state.project.timeline.overlayBlocks;
            const blockIdx = overlayBlocks.findIndex(b => b.id === blockId);
            if (blockIdx === -1) return state;

            const block = overlayBlocks[blockIdx];
            const nextItems = block.items.filter(i => i.id !== itemId);

            const nextBlocks = [...overlayBlocks];
            nextBlocks[blockIdx] = { ...block, items: nextItems };

            return {
                project: {
                    ...state.project,
                    timeline: {
                        ...state.project.timeline,
                        overlayBlocks: nextBlocks
                    }
                }
            };
        });
    },

    toggleOverlayEnabled: () => {
        set(state => {
            const currentEnabled = state.project.settings.overlay?.enabled ?? true;
            return {
                project: {
                    ...state.project,
                    settings: {
                        ...state.project.settings,
                        overlay: {
                            ...state.project.settings.overlay,
                            enabled: !currentEnabled,
                            defaultDurationMs: state.project.settings.overlay?.defaultDurationMs ?? 3000,
                        }
                    }
                }
            };
        });
    },
});
