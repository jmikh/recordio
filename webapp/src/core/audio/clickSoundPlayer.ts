import type { BaseEvent, DragEvent } from '@shared/types';
import type { TimeMapper } from '../mappers/timeMapper';
import { useUIStore } from '../../editor/stores/useUIStore';
import { CDN_ORIGIN } from '@shared/types/bridge';

const CLICK_SOUND_URL = `${CDN_ORIGIN}/sounds/mouse-click.mp3`;
const MOUSE_DOWN_SOUND_URL = `${CDN_ORIGIN}/sounds/mouse-down.mp3`;
const MOUSE_UP_SOUND_URL = `${CDN_ORIGIN}/sounds/mouse-up.mp3`;

let audioContext: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let mouseDownBuffer: AudioBuffer | null = null;
let mouseUpBuffer: AudioBuffer | null = null;
let loadingPromise: Promise<void> | null = null;
let lastSeenTime = 0;

/**
 * Lazily initializes the AudioContext and loads all sound buffers.
 */
async function ensureLoaded(): Promise<void> {
    if (audioBuffer && mouseDownBuffer && mouseUpBuffer) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        audioContext = new AudioContext();
        const [clickResp, downResp, upResp] = await Promise.all([
            fetch(CLICK_SOUND_URL),
            fetch(MOUSE_DOWN_SOUND_URL),
            fetch(MOUSE_UP_SOUND_URL),
        ]);
        const [clickBuf, downBuf, upBuf] = await Promise.all([
            clickResp.arrayBuffer(),
            downResp.arrayBuffer(),
            upResp.arrayBuffer(),
        ]);
        [audioBuffer, mouseDownBuffer, mouseUpBuffer] = await Promise.all([
            audioContext.decodeAudioData(clickBuf),
            audioContext.decodeAudioData(downBuf),
            audioContext.decodeAudioData(upBuf),
        ]);
    })();

    return loadingPromise;
}

/** Play a buffer at a given volume */
function playBuffer(buffer: AudioBuffer, volume: number): void {
    if (!audioContext) return;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.start(0);
}

/** Set of click timestamps already played this playback session */
const playedClicks = new Set<number>();

/**
 * Plays the click sound for any click events at the current time.
 * Event timestamps are source time; mapped to output time via timeMapper.
 */
export function playClickSounds(
    events: BaseEvent[],
    currentOutputTime: number,
    volume: number,
    timeMapper: TimeMapper
): void {
    // Only play sounds during active playback
    if (!useUIStore.getState().isPlaying) return;

    if (!audioContext || !audioBuffer) {
        // Trigger lazy load on first call
        ensureLoaded();
        return;
    }

    // Resume AudioContext if browser suspended it (requires user gesture)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
        return;
    }

    // Detect backward seek — if time jumped backward, reset played set
    if (currentOutputTime < lastSeenTime - 50) {
        playedClicks.clear();
    }
    lastSeenTime = currentOutputTime;

    for (const click of events) {
        const mappedTime = timeMapper.mapSourceToOutputTime(click.timestamp);
        if (mappedTime < 0) continue; // Event is in a cut/hidden segment

        // Only play each click once — check within a small window
        if (
            currentOutputTime >= mappedTime &&
            currentOutputTime <= mappedTime + 100 &&
            !playedClicks.has(click.timestamp)
        ) {
            playedClicks.add(click.timestamp);
            playBuffer(audioBuffer, volume);
        }
    }
}

/** Sets of drag start/end timestamps already played this playback session */
const playedDragStarts = new Set<number>();
const playedDragEnds = new Set<number>();
let lastSeenDragTime = 0;

/**
 * Plays mouse_down at drag start and mouse_up at drag end.
 * Drag timestamps are source time; mapped to output time via timeMapper.
 */
export function playDragSounds(
    drags: DragEvent[],
    currentOutputTime: number,
    volume: number,
    timeMapper: TimeMapper
): void {
    if (!useUIStore.getState().isPlaying) return;

    if (!audioContext || !mouseDownBuffer || !mouseUpBuffer) {
        ensureLoaded();
        return;
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume();
        return;
    }

    // Detect backward seek
    if (currentOutputTime < lastSeenDragTime - 50) {
        playedDragStarts.clear();
        playedDragEnds.clear();
    }
    lastSeenDragTime = currentOutputTime;

    for (const drag of drags) {
        // Map drag range to output time
        const mappedRange = timeMapper.mapSourceRangeToOutputRange(drag.timestamp, drag.endTime);
        if (!mappedRange) continue; // Drag is entirely in a cut/hidden segment

        const { start: outputStart, end: outputEnd } = mappedRange;

        // Mouse down at drag start
        if (
            currentOutputTime >= outputStart &&
            currentOutputTime <= outputStart + 100 &&
            !playedDragStarts.has(drag.timestamp)
        ) {
            playedDragStarts.add(drag.timestamp);
            playBuffer(mouseDownBuffer, volume);
        }

        // Mouse up at drag end
        if (
            currentOutputTime >= outputEnd &&
            currentOutputTime <= outputEnd + 100 &&
            !playedDragEnds.has(drag.endTime)
        ) {
            playedDragEnds.add(drag.endTime);
            playBuffer(mouseUpBuffer, volume);
        }
    }
}

/**
 * Resets the played clicks and drag sound trackers. Call when playback is stopped or seeked.
 */
export function resetClickSounds(): void {
    playedClicks.clear();
    playedDragStarts.clear();
    playedDragEnds.clear();
    lastSeenTime = 0;
    lastSeenDragTime = 0;
}

/**
 * Pre-loads all sound buffers. Call early to avoid delay on first play.
 */
export function preloadClickSound(): void {
    ensureLoaded();
}

/**
 * Returns the loaded click AudioBuffer for use in export mixing.
 * Returns null if not yet loaded.
 */
export async function getClickSoundBuffer(): Promise<AudioBuffer | null> {
    await ensureLoaded();
    return audioBuffer;
}

/**
 * Returns the loaded drag sound AudioBuffers for use in export mixing.
 */
export async function getDragSoundBuffers(): Promise<{ down: AudioBuffer | null; up: AudioBuffer | null }> {
    await ensureLoaded();
    return { down: mouseDownBuffer, up: mouseUpBuffer };
}

/**
 * Preview the click sound at the given volume (0–1).
 * For use in the settings UI — does not require active playback.
 */
export async function previewClickSound(volume: number): Promise<void> {
    await ensureLoaded();
    if (!audioContext || !audioBuffer) return;
    if (audioContext.state === 'suspended') await audioContext.resume();
    playBuffer(audioBuffer, volume);
}

/**
 * Preview the drag sound at the given volume (0–1).
 * Plays mouse_down immediately, then mouse_up after 600ms.
 * Returns a cleanup function to cancel the scheduled mouse_up.
 */
export async function previewDragSound(volume: number): Promise<() => void> {
    await ensureLoaded();
    if (!audioContext || !mouseDownBuffer || !mouseUpBuffer) return () => { };
    if (audioContext.state === 'suspended') await audioContext.resume();
    playBuffer(mouseDownBuffer, volume);
    const timer = setTimeout(() => {
        if (mouseUpBuffer) playBuffer(mouseUpBuffer, volume);
    }, 600);
    return () => clearTimeout(timer);
}
