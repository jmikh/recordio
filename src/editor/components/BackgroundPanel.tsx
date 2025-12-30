
import { useProjectStore, useProjectData } from '../stores/useProjectStore';

const BACKGROUND_IMAGES = [
    { name: 'Abstract Gradient', url: '/assets/backgrounds/abstract-gradient.jpg' },
    // Add more here if needed
];

export const BackgroundPanel = () => {
    const project = useProjectData();
    const updateSettings = useProjectStore(s => s.updateSettings);

    if (!project) return null;

    // Defensive: Ensure background exists (migration fallback)
    const background = {
        type: project.settings.backgroundType,
        color: project.settings.backgroundColor,
        padding: project.settings.padding,
        imageUrl: project.settings.backgroundImageUrl
    };

    const updateBackground = (updates: Partial<typeof background>) => {
        // Map back to flat updates
        const flatUpdates: any = {};
        if (updates.type) flatUpdates.backgroundType = updates.type;
        if (updates.color) flatUpdates.backgroundColor = updates.color;
        if (updates.padding !== undefined) flatUpdates.padding = updates.padding;
        if (updates.imageUrl !== undefined) flatUpdates.backgroundImageUrl = updates.imageUrl;

        updateSettings(flatUpdates);
    };

    return (
        <div className="w-64 bg-[#252526] border-r border-[#333] flex flex-col text-gray-300">
            <div className="p-3 border-b border-[#333] font-bold text-sm">
                Background
            </div>

            <div className="p-4 flex flex-col gap-4">
                {/* Type Selector */}
                <div className="flex bg-black rounded p-1">
                    <button
                        className={`flex-1 text-xs py-1 rounded ${background.type === 'solid' ? 'bg-[#37373d] text-white' : 'hover:bg-[#37373d] text-gray-500'}`}
                        onClick={() => updateBackground({ type: 'solid' })}
                    >
                        Solid
                    </button>
                    <button
                        className={`flex-1 text-xs py-1 rounded ${background.type === 'image' ? 'bg-[#37373d] text-white' : 'hover:bg-[#37373d] text-gray-500'}`}
                        onClick={() => updateBackground({ type: 'image' })}
                    >
                        Image
                    </button>
                </div>

                {/* Content */}
                {background.type === 'solid' ? (
                    <div>
                        <label className="text-xs mb-1 block">Color</label>
                        <div className="flex gap-2 items-center">
                            <input
                                type="color"
                                value={background.color || '#000000'}
                                onChange={(e) => updateBackground({ color: e.target.value })}
                                className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                            />
                            <span className="text-xs font-mono">{background.color}</span>
                        </div>
                    </div>
                ) : (
                    <div>
                        <label className="text-xs mb-1 block">Image</label>
                        <div className="grid grid-cols-2 gap-2">
                            {BACKGROUND_IMAGES.map(img => (
                                <div
                                    key={img.url}
                                    className={`cursor-pointer border-2 rounded overflow-hidden aspect-video ${background.imageUrl === img.url ? 'border-blue-500' : 'border-transparent hover:border-gray-500'}`}
                                    onClick={() => updateBackground({ imageUrl: img.url })}
                                >
                                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
