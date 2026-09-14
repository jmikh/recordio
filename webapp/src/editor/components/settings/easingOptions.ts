import type { DropdownOption } from '@shared/components';
import type { EasingStyle } from '@shared/animators/easing';

/** Easing choices shared by the Motion settings and the zoom / spotlight inspectors. */
export const EASING_OPTIONS: DropdownOption<EasingStyle>[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
];
