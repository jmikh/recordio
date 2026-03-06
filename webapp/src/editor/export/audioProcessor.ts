/**
 * @fileoverview Audio rendering pipeline for video export.
 *
 * Handles mixing screen audio, microphone audio, and background music
 * into a single rendered AudioBuffer using OfflineAudioContext, then
 * encodes it into chunks via WebCodecs AudioEncoder.
 */

import type { Project, ScreenMetadata } from '../../types';

interface AudioRenderOptions {
    project: Project;
    totalDurationSec: number;
    sampleRate?: number;
}

/**
 * Render all audio tracks (screen, mic, music) into a single AudioBuffer.
 *
 * Uses OfflineAudioContext for sample-accurate mixing with per-source
 * volume control and speed-aware windowed playback.
 */
export async function renderAudioBuffer(options: AudioRenderOptions): Promise<AudioBuffer> {
    const { project, totalDurationSec, sampleRate = 44100 } = options;
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDurationSec), sampleRate);

    const audioSettings = project.settings.audio;

    // --- Build audio sources independently: screen audio + mic audio ---
    const audioSources: { url: string; volume: number }[] = [];

    // Screen audio (system audio)
    if ((project.screenSource as ScreenMetadata).hasAudio && !audioSettings?.muteScreenAudio) {
        const screenUrl = project.screenSource.runtimeUrl;
        if (screenUrl) {
            audioSources.push({
                url: screenUrl,
                volume: audioSettings?.screenVolume ?? 1,
            });
        }
    }

    // Microphone audio (separate track)
    if (project.microphoneSource?.runtimeUrl && !audioSettings?.muteMicrophone) {
        audioSources.push({
            url: project.microphoneSource.runtimeUrl,
            volume: audioSettings?.microphoneVolume ?? 1,
        });
    }

    await Promise.all(audioSources.map(async (audioSource) => {
        try {
            const response = await fetch(audioSource.url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

            let outputAccSec = 0;
            project.timeline.outputWindows.forEach((window: any) => {
                const speed = window.speed || 1.0;
                const sourceNode = offlineCtx.createBufferSource();
                sourceNode.buffer = audioBuffer;
                sourceNode.playbackRate.value = speed;

                // Apply per-source volume via GainNode
                const gainNode = offlineCtx.createGain();
                gainNode.gain.setValueAtTime(audioSource.volume, 0);
                sourceNode.connect(gainNode);
                gainNode.connect(offlineCtx.destination);

                const offset = window.startMs / 1000;
                const duration = (window.endMs - window.startMs) / 1000;
                const startTime = outputAccSec;
                outputAccSec += duration / speed;

                if (offset >= 0 && offset < audioBuffer.duration) {
                    sourceNode.start(startTime, offset, duration);
                }
            });
        } catch (error) {
            console.warn(`[Export] Failed to decode audio for source:`, error);
        }
    }));

    // --- Background Music Track ---
    if (audioSettings?.music?.enabled) {
        const musicUrl = audioSettings.music.source === 'preset'
            ? audioSettings.music.presetUrl
            : audioSettings.music.customRuntimeUrl;

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

    return offlineCtx.startRendering();
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
        // Bail out if the encoder errored and closed itself
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
