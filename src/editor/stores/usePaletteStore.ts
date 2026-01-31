import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Default palette colors - pastels from Tailwind
const DEFAULT_PALETTE: string[] = [
    // Row 1 - Pastels
    '#fecaca', // Red-200
    '#fed7aa', // Orange-200
    '#fde68a', // Amber-200
    '#d9f99d', // Lime-200
    '#bbf7d0', // Green-200
    '#99f6e4', // Teal-200
    '#a5f3fc', // Cyan-200
    // Row 2 - More pastels
    '#bae6fd', // Sky-200
    '#c7d2fe', // Indigo-200
    '#ddd6fe', // Violet-200
    '#f5d0fe', // Fuchsia-200
    '#fbcfe8', // Pink-200
    '#e2e8f0', // Slate-200
    '#ffffff', // White
];

export interface PaletteState {
    palette: string[];
    updatePaletteColor: (index: number, color: string) => void;
    resetPalette: () => void;
}

export const usePaletteStore = create<PaletteState>()(
    persist(
        (set) => ({
            palette: [...DEFAULT_PALETTE],

            updatePaletteColor: (index, color) =>
                set((state) => {
                    const newPalette = [...state.palette];
                    if (index >= 0 && index < newPalette.length) {
                        newPalette[index] = color;
                    }
                    return { palette: newPalette };
                }),

            resetPalette: () => set({ palette: [...DEFAULT_PALETTE] }),
        }),
        {
            name: 'recordio-palette-storage',
        }
    )
);
