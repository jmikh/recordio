import { useProjectStore } from '../../stores/useProjectStore';
import type { CaptionSegment } from '../../../core/types';

/**
 * Settings panel for managing captions.
 */
export function CaptionsControls() {
    const project = useProjectStore(state => state.project);
    const updateSettings = useProjectStore(state => state.updateSettings);
    const generateTranscription = useProjectStore(state => state.generateTranscription);
    const isTranscribing = useProjectStore(state => state.isTranscribing);
    const transcriptionProgress = useProjectStore(state => state.transcriptionProgress);
    const transcriptionError = useProjectStore(state => state.transcriptionError);

    const captions = project.timeline.recording.captions;
    const settings = project.settings.captions || { visible: true, size: 24 };

    const handleGenerate = async () => {
        try {
            console.log('[CaptionsControls] Starting transcription generation');
            await generateTranscription();
        } catch (error) {
            console.error('[CaptionsControls] Failed to generate transcription:', error);
        }
    };

    const formatTime = (ms: number) => {
        const seconds = ms / 1000;
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(1);
        return `${mins}:${secs.padStart(4, '0')}`;
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-main">Captions</h3>
                {captions && (
                    <span className="text-xs text-text-muted">
                        {captions.segments.length} segments
                    </span>
                )}
            </div>

            {/* Caption Settings */}
            <div className="space-y-3 pb-3 border-b border-border">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-text-muted">Visible</label>
                    <button
                        onClick={() => updateSettings({ captions: { ...settings, visible: !settings.visible } })}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${settings.visible ? 'bg-settings-primary' : 'bg-surface-elevated'
                            }`}
                    >
                        <span
                            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${settings.visible ? 'translate-x-5' : 'translate-x-1'
                                }`}
                        />
                    </button>
                </div>

                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-text-muted">Size</label>
                        <span className="text-xs text-text-muted">{settings.size}px</span>
                    </div>
                    <input
                        type="range"
                        min="16"
                        max="48"
                        step="2"
                        value={settings.size}
                        onChange={(e) => updateSettings({ captions: { ...settings, size: Number(e.target.value) } })}
                        className="w-full h-1 bg-surface-elevated rounded-lg appearance-none cursor-pointer slider"
                    />
                </div>
            </div>

            {!captions && !isTranscribing && (
                <button
                    onClick={handleGenerate}
                    className="w-full px-4 py-2 bg-settings-primary text-primary-fg rounded-lg hover:bg-settings-primary/90 transition-colors text-sm font-medium"
                >
                    Generate Captions
                </button>
            )}

            {isTranscribing && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-text-muted">
                        <span>Transcribing audio...</span>
                        <span>{Math.round(transcriptionProgress * 100)}%</span>
                    </div>
                    <div className="w-full h-2 bg-surface-elevated rounded-full overflow-hidden">
                        <div
                            className="h-full bg-settings-primary transition-all duration-300"
                            style={{ width: `${transcriptionProgress * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {transcriptionError && (
                <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded border border-red-500/20">
                    {transcriptionError}
                </div>
            )}

            {captions && captions.segments.length > 0 && (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                    <div className="text-xs font-medium text-text-muted mb-2">Caption Segments</div>
                    <div className="space-y-1">
                        {captions.segments.map((segment: CaptionSegment) => (
                            <div
                                key={segment.id}
                                className="flex gap-3 p-2 bg-surface-elevated rounded text-xs hover:bg-surface-elevated/80 transition-colors"
                            >
                                <div className="flex flex-col gap-0.5 text-text-muted font-mono shrink-0 w-16">
                                    <div>{formatTime(segment.sourceStartMs)}</div>
                                    <div>{formatTime(segment.sourceEndMs)}</div>
                                </div>
                                <div className="flex-1 text-text-main leading-relaxed">
                                    {segment.text}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <p className="text-xs text-text-muted">
                Captions generated using local AI models running entirely in your browser.
            </p>
        </div>
    );
}
