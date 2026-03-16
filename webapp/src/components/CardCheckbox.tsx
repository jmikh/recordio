interface CardCheckboxProps {
    selectMode: boolean;
    selected: boolean;
    onSelect: () => void;
}

export const CardCheckbox = ({ selectMode, selected, onSelect }: CardCheckboxProps) => {
    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect();
    };

    return (
        <div
            className={`
                absolute top-1.5 left-1.5 z-10 transition-opacity duration-150
                ${selectMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
            `}
            onClick={handleClick}
        >
            <div className={`
                w-5 h-5 rounded flex items-center justify-center transition-all duration-200 border
                ${selected
                    ? 'bg-primary border-primary'
                    : 'bg-surface-raised/90 border-text-disabled'
                }
            `}>
                {selected && (
                    <svg className="w-3 h-3 text-text-on-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                )}
            </div>
        </div>
    );
};
