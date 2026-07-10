/**
 * VAD (Voice Activity Detection) Service
 *
 * Uses @ricky0123/vad-web with Silero ONNX model for accurate
 * speech detection in pre-recorded audio.
 *
 * NOTE: Loads library from CDN to avoid Vite/CommonJS bundling issues.
 * The vad-web library uses CommonJS requires that Vite cannot handle.
 */
import { captureError } from '../../lib/sentry';

// ============================================================================
// VAD Configuration
// ============================================================================

/**
 * VAD (Voice Activity Detection) Configuration
 * 
 * Tune these values to adjust speech detection sensitivity for AutoCut.
 */

/** 
 * Threshold for STARTING speech detection (0-1).
 * Lower = more sensitive (catches quieter speech).
 * Higher = less sensitive (only loud/clear speech).
 * Default: 0.5
 */
const POSITIVE_SPEECH_THRESHOLD = 0.4;

/** 
 * Threshold for ENDING speech detection (0-1).
 * Lower = keeps speech segments longer (doesn't cut off trailing words).
 * Higher = ends speech faster (tighter cuts).
 * Default: 0.35
 */
const NEGATIVE_SPEECH_THRESHOLD = 0.35;

/** 
 * Minimum duration for a valid speech segment (milliseconds).
 * Filters out very short bursts (clicks, pops).
 * Lower = catches brief utterances.
 * Higher = ignores short sounds.
 * Default: 250
 */
const MIN_SPEECH_MS = 500;

/** 
 * Padding BEFORE detected speech starts (milliseconds).
 * Prevents cutting off the first syllable.
 * Higher = more breathing room at start.
 * Default: 300
 */
const PRE_SPEECH_PAD_MS = 750;

/** 
 * How long to wait during silence before ending the speech segment (milliseconds).
 * Bridges short pauses (like "um", breathing between sentences).
 * Lower = splits on brief pauses.
 * Higher = keeps longer pauses as one segment.
 * Default: 5000
 */
const REDEMPTION_MS = 500;

// ============================================================================
// Types
// ============================================================================

export interface SpeechSegment {
    startMs: number;
    endMs: number;
}

// CDN URLs for the VAD library
const ONNX_RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js';
const VAD_WEB_URL = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/bundle.min.js';

// ============================================================================
// Script Loading
// ============================================================================

let scriptsLoaded = false;
let scriptsLoading: Promise<void> | null = null;

/**
 * Load VAD scripts from CDN if not already loaded.
 */
async function loadVADScripts(): Promise<void> {
    if (scriptsLoaded) return;
    if (scriptsLoading) return scriptsLoading;

    scriptsLoading = (async () => {
        // Load ONNX Runtime first
        await loadScript(ONNX_RUNTIME_URL);
        // Then load VAD Web
        await loadScript(VAD_WEB_URL);
        scriptsLoaded = true;
    })();

    await scriptsLoading;
    scriptsLoading = null;
}

/**
 * Helper to load a script dynamically.
 */
function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // Check if already loaded
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

// ============================================================================
// VAD Instance Management
// ============================================================================

// Access the global 'vad' object that the CDN script creates
declare global {
    interface Window {
        vad: {
            NonRealTimeVAD: {
                new: (options?: object) => Promise<{
                    run: (audio: Float32Array, sampleRate: number) => AsyncGenerator<{
                        audio: Float32Array;
                        start: number;
                        end: number;
                    }>;
                }>;
            };
            utils: {
                audioFileToArray: (blob: Blob) => Promise<{ audio: Float32Array; sampleRate: number }>;
            };
        };
    }
}

type VADInstance = Awaited<ReturnType<typeof window.vad.NonRealTimeVAD.new>>;
let vadInstance: VADInstance | null = null;
let vadInitializing: Promise<VADInstance> | null = null;

// Reset VAD on HMR during development
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        vadInstance = null;
        vadInitializing = null;
        vadCache.clear();
    });
}

/**
 * Get or create the shared VAD instance.
 */
async function getVAD(): Promise<VADInstance> {
    await loadVADScripts();

    if (vadInstance) return vadInstance;
    if (vadInitializing) return vadInitializing;

    vadInitializing = window.vad.NonRealTimeVAD.new({
        positiveSpeechThreshold: POSITIVE_SPEECH_THRESHOLD,
        negativeSpeechThreshold: NEGATIVE_SPEECH_THRESHOLD,
        minSpeechMs: MIN_SPEECH_MS,
        preSpeechPadMs: PRE_SPEECH_PAD_MS,
        redemptionMs: REDEMPTION_MS,
        // Disable multi-threading to avoid crossOriginIsolated warning in dev
        ortConfig: (ort: { env: { wasm: { numThreads: number } } }) => {
            ort.env.wasm.numThreads = 1;
        }
    });
    vadInstance = await vadInitializing;
    vadInitializing = null;

    return vadInstance;
}

// ============================================================================
// Audio Extraction
// ============================================================================

/**
 * Extract audio from a video/audio URL as a Blob.
 */
async function fetchAudioBlob(url: string): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }
    const blob = await response.blob();
    // Force audio type to help decodeAudioData focus on audio track
    return new Blob([blob], { type: 'audio/webm' });
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Analyze audio from a URL and detect speech segments.
 * 
 * @param audioUrl URL to audio/video file (blob URL or http)
 * @returns Array of speech segments with startMs/endMs
 */
export async function detectSpeechSegments(audioUrl: string): Promise<SpeechSegment[]> {
    // 1. Ensure scripts are loaded
    await loadVADScripts();

    // 2. Fetch audio as blob
    const audioBlob = await fetchAudioBlob(audioUrl);

    // 3. Decode audio using native AudioContext (more robust than vad-web utils)
    // Create offline context for decoding
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await audioBlob.arrayBuffer();

    let audioBuffer: AudioBuffer;
    try {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } catch (e) {
        captureError(e, { flow: 'autocut', phase: 'vad_decode' });
        throw new Error('Failed to decode audio data. The file format may not be supported.');
    }

    // Extract channel data (mix to mono if needed)
    let audio: Float32Array;
    if (audioBuffer.numberOfChannels === 1) {
        audio = audioBuffer.getChannelData(0);
    } else {
        // Average channels for mono
        const left = audioBuffer.getChannelData(0);
        const right = audioBuffer.getChannelData(1);
        audio = new Float32Array(left.length);
        for (let i = 0; i < audio.length; i++) {
            audio[i] = (left[i] + right[i]) / 2;
        }
    }
    const sampleRate = audioBuffer.sampleRate;

    // 4. Get VAD instance
    const vad = await getVAD();

    // 5. Run VAD analysis
    const segments: SpeechSegment[] = [];

    for await (const segment of vad.run(audio, sampleRate)) {
        segments.push({
            startMs: segment.start,
            endMs: segment.end
        });
    }

    return segments;
}

/**
 * Cache for VAD results to avoid re-analyzing the same audio.
 */
const vadCache = new Map<string, SpeechSegment[]>();

/**
 * Get cached speech segments or run analysis.
 */
export async function getCachedSpeechSegments(
    audioUrl: string,
    forceRefresh = false
): Promise<SpeechSegment[]> {
    // TEMP: Cache disabled for debugging
    // if (!forceRefresh && vadCache.has(audioUrl)) {
    //     return vadCache.get(audioUrl)!;
    // }

    const segments = await detectSpeechSegments(audioUrl);
    // vadCache.set(audioUrl, segments);

    return segments;
}

/**
 * Clear the VAD cache.
 */
export function clearVADCache(): void {
    vadCache.clear();
}
