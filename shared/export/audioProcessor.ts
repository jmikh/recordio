/**
 * @fileoverview Audio rendering pipeline for video export.
 *
 * Handles mixing screen audio, microphone audio, background music,
 * and click/drag sound effects into a single rendered AudioBuffer
 * using OfflineAudioContext, then encodes it into chunks via WebCodecs
 * AudioEncoder.
 */

import type { Project, ScreenMetadata, UserEvents } from '../types';
import type { TimeMapper } from '../mappers/timeMapper';
import { SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs';

/**
 * Injectable sound effect buffers.
 * In webapp: loaded from CDN via clickSoundPlayer.
 * In headless render: loaded from local files.
 */
export interface SoundEffectBuffers {
    click: AudioBuffer | null;
    dragDown: AudioBuffer | null;
    dragUp: AudioBuffer | null;
}

interface AudioRenderOptions {
    project: Project;
    totalDurationSec: number;
    userEvents?: UserEvents;
    timeMapper?: TimeMapper;
    sampleRate?: number;
    /** Optional sound effect buffers for click/drag mixing. */
    soundEffects?: SoundEffectBuffers;
    /** Media URLs keyed by source ID. */
    mediaUrls?: Record<string, string>;
}

/**
 * Render all audio tracks (screen, mic, music, click/drag effects) into a
 * single AudioBuffer.
 *
 * Uses OfflineAudioContext for sample-accurate mixing with per-source
 * volume control and speed-aware windowed playback.
 */
export async function renderAudioBuffer(options: AudioRenderOptions): Promise<AudioBuffer> {
    const { project, totalDurationSec, userEvents, timeMapper, sampleRate = 44100, soundEffects, mediaUrls = {} } = options;
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDurationSec), sampleRate);

    const audioSettings = project.settings.audio;

    // --- Build audio sources independently: screen audio + mic audio ---
    const audioSources: { url: string; volume: number }[] = [];

    // Screen audio (system audio)
    if ((project.screenSource as ScreenMetadata).hasAudio && !audioSettings?.muteScreenAudio) {
        const screenUrl = mediaUrls[project.screenSource.storagePath];
        if (screenUrl) {
            audioSources.push({
                url: screenUrl,
                volume: audioSettings?.screenVolume ?? 1,
            });
        }
    }

    // Microphone audio (separate track)
    const micUrl = project.microphoneSource ? mediaUrls[project.microphoneSource.storagePath] : undefined;
    if (micUrl && !audioSettings?.muteMicrophone) {
        audioSources.push({
            url: micUrl,
            volume: audioSettings?.microphoneVolume ?? 1,
        });
    }

    await Promise.all(audioSources.map(async (audioSource) => {
        try {
            console.log(`[Export:Audio] Fetching audio URL: "${audioSource.url}" (type=${audioSource.url?.startsWith('blob:') ? 'blob' : 'network'}, volume=${audioSource.volume})`);
            const response = await fetch(audioSource.url);
            if (!response.ok) {
                console.error(`[Export:Audio] Audio fetch returned ${response.status} ${response.statusText} for URL: "${audioSource.url}"`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

            let outputAccSec = 0;
            for (const window of project.timeline.outputWindows as any[]) {
                const speed = window.speed || 1.0;
                const offset = window.startMs / 1000;
                const duration = (window.endMs - window.startMs) / 1000;
                const startTime = outputAccSec;
                const outputDuration = duration / speed;
                outputAccSec += outputDuration;

                if (offset < 0 || offset >= audioBuffer.duration) continue;

                // For 1x speed, schedule directly — no processing needed
                if (Math.abs(speed - 1.0) < 0.001) {
                    const sourceNode = offlineCtx.createBufferSource();
                    sourceNode.buffer = audioBuffer;
                    const gainNode = offlineCtx.createGain();
                    gainNode.gain.setValueAtTime(audioSource.volume, 0);
                    sourceNode.connect(gainNode);
                    gainNode.connect(offlineCtx.destination);
                    sourceNode.start(startTime, offset, duration);
                    continue;
                }

                // Pitch-preserving time-stretch via SoundTouch
                const stretchedBuffer = timeStretchWithSoundTouch(
                    offlineCtx, audioBuffer, offset, duration, speed
                );

                if (!stretchedBuffer) continue;

                const sourceNode = offlineCtx.createBufferSource();
                sourceNode.buffer = stretchedBuffer;
                const gainNode = offlineCtx.createGain();
                gainNode.gain.setValueAtTime(audioSource.volume, 0);
                sourceNode.connect(gainNode);
                gainNode.connect(offlineCtx.destination);
                sourceNode.start(startTime);
            }
        } catch (error) {
            console.warn(`[Export] Failed to decode audio for source:`, error);
        }
    }));

    // --- Background Music Track ---
    if (audioSettings?.music?.enabled) {
        const musicUrl = audioSettings.music.source === 'preset'
            ? audioSettings.music.presetUrl
            : (audioSettings.music.storagePath && mediaUrls?.[audioSettings.music.storagePath])
              || undefined;

        if (musicUrl) {
            try {
                const response = await fetch(musicUrl);
                const arrayBuffer = await response.arrayBuffer();
                const musicBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

                const musicSource = offlineCtx.createBufferSource();
                musicSource.buffer = musicBuffer;
                musicSource.loop = true;

                // Volume control via GainNode
                const gainNode = offlineCtx.createGain();
                const musicVolume = audioSettings.music.volume ?? 0.3;
                gainNode.gain.setValueAtTime(musicVolume, 0);

                // Fade out at end
                const fadeMs = audioSettings.music.fadeOutDurationMs ?? 3000;
                if (fadeMs > 0) {
                    const fadeStartSec = Math.max(0, totalDurationSec - (fadeMs / 1000));
                    gainNode.gain.setValueAtTime(musicVolume, fadeStartSec);
                    gainNode.gain.linearRampToValueAtTime(0, totalDurationSec);
                }

                musicSource.connect(gainNode);
                gainNode.connect(offlineCtx.destination);
                musicSource.start(0); // Music starts at the beginning of the output
            } catch (error) {
                console.warn('[Export] Failed to load background music:', error);
            }
        }
    }

    // --- Click & Drag Sound Effects ---
    const mouseSettings = project.settings.mouse;
    if (mouseSettings?.soundEnabled && userEvents && timeMapper && soundEffects) {
        try {
            const volume = mouseSettings.soundVolume ?? 0.5;

            // Schedule click sounds
            if (soundEffects.click) {
                const clickOfflineBuffer = resampleBuffer(offlineCtx, soundEffects.click);
                for (const click of userEvents.mouseClicks) {
                    const outputTimeMs = timeMapper.mapSourceToOutputTime(click.timestamp);
                    if (outputTimeMs < 0) continue;
                    const outputTimeSec = outputTimeMs / 1000;
                    if (outputTimeSec >= totalDurationSec) continue;

                    const source = offlineCtx.createBufferSource();
                    source.buffer = clickOfflineBuffer;
                    const gainNode = offlineCtx.createGain();
                    gainNode.gain.value = volume;
                    source.connect(gainNode);
                    gainNode.connect(offlineCtx.destination);
                    source.start(outputTimeSec);
                }
            }

            // Schedule drag sounds (mouse_down at start, mouse_up at end)
            if (soundEffects.dragDown && soundEffects.dragUp) {
                const downOfflineBuffer = resampleBuffer(offlineCtx, soundEffects.dragDown);
                const upOfflineBuffer = resampleBuffer(offlineCtx, soundEffects.dragUp);
                for (const drag of userEvents.drags) {
                    const mappedRange = timeMapper.mapSourceRangeToOutputRange(drag.timestamp, drag.endTime);
                    if (!mappedRange) continue;

                    const startSec = mappedRange.start / 1000;
                    const endSec = mappedRange.end / 1000;

                    if (startSec < totalDurationSec) {
                        const downSource = offlineCtx.createBufferSource();
                        downSource.buffer = downOfflineBuffer;
                        const downGain = offlineCtx.createGain();
                        downGain.gain.value = volume;
                        downSource.connect(downGain);
                        downGain.connect(offlineCtx.destination);
                        downSource.start(startSec);
                    }

                    if (endSec < totalDurationSec) {
                        const upSource = offlineCtx.createBufferSource();
                        upSource.buffer = upOfflineBuffer;
                        const upGain = offlineCtx.createGain();
                        upGain.gain.value = volume;
                        upSource.connect(upGain);
                        upGain.connect(offlineCtx.destination);
                        upSource.start(endSec);
                    }
                }
            }
        } catch (error) {
            console.warn('[Export] Failed to mix click/drag sounds:', error);
        }
    }

    return offlineCtx.startRendering();
}

/**
 * Pitch-preserving time-stretch using the SoundTouch library.
 */
function timeStretchWithSoundTouch(
    ctx: OfflineAudioContext,
    audioBuffer: AudioBuffer,
    offsetSec: number,
    durationSec: number,
    speed: number
): AudioBuffer | null {
    const sr = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;
    const srcStartFrame = Math.floor(offsetSec * sr);
    const srcFrames = Math.min(
        Math.ceil(durationSec * sr),
        audioBuffer.length - srcStartFrame
    );

    if (srcFrames <= 0) return null;

    const segmentBuffer = ctx.createBuffer(channels, srcFrames, sr);
    for (let c = 0; c < channels; c++) {
        const fullChannel = audioBuffer.getChannelData(c);
        const segChannel = segmentBuffer.getChannelData(c);
        segChannel.set(fullChannel.subarray(srcStartFrame, srcStartFrame + srcFrames));
    }

    const st = new SoundTouch();
    st.tempo = speed;
    st.rate = 1.0;

    const source = new WebAudioBufferSource(segmentBuffer);
    const filter = new SimpleFilter(source, st);

    const expectedOutputFrames = Math.ceil(srcFrames / speed);
    const maxOutputFrames = expectedOutputFrames + Math.ceil(sr * 0.1);

    const interleavedOutput = new Float32Array(maxOutputFrames * 2);
    const extractedFrames = filter.extract(interleavedOutput, maxOutputFrames);

    if (extractedFrames <= 0) return null;

    const outputBuffer = ctx.createBuffer(channels, extractedFrames, sr);
    const leftOut = outputBuffer.getChannelData(0);
    const rightOut = channels > 1 ? outputBuffer.getChannelData(1) : null;

    for (let i = 0; i < extractedFrames; i++) {
        leftOut[i] = interleavedOutput[i * 2];
        if (rightOut) {
            rightOut[i] = interleavedOutput[i * 2 + 1];
        }
    }

    return outputBuffer;
}

/**
 * Copy an AudioBuffer into the target OfflineAudioContext so it can be
 * scheduled on that context's timeline.
 */
function resampleBuffer(ctx: OfflineAudioContext, source: AudioBuffer): AudioBuffer {
    const buf = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
    for (let c = 0; c < source.numberOfChannels; c++) {
        buf.copyToChannel(source.getChannelData(c), c);
    }
    return buf;
}

/**
 * Encode a rendered AudioBuffer into WebCodecs AudioEncoder chunks.
 *
 * Processes audio in 1-second chunks (44100 frames) to keep memory
 * manageable. Bails out early if the encoder closes due to an error.
 */
export function encodeAudioBuffer(audioBuffer: AudioBuffer, encoder: AudioEncoder): void {
    const totalFrames = audioBuffer.length;
    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const chunkSize = 44100;

    for (let frameOffset = 0; frameOffset < totalFrames; frameOffset += chunkSize) {
        if (encoder.state === 'closed') {
            console.warn('[Export] Audio encoder closed mid-encode — skipping remaining audio');
            return;
        }

        const size = Math.min(chunkSize, totalFrames - frameOffset);
        const destBuffer = new Float32Array(size * channels);

        for (let c = 0; c < channels; c++) {
            const channelData = audioBuffer.getChannelData(c);
            const segment = channelData.subarray(frameOffset, frameOffset + size);
            destBuffer.set(segment, c * size);
        }

        const timestampMicros = (frameOffset / sampleRate) * 1000000;

        const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate,
            numberOfFrames: size,
            numberOfChannels: channels,
            timestamp: timestampMicros,
            data: destBuffer
        });

        encoder.encode(audioData);
        audioData.close();
    }
}
