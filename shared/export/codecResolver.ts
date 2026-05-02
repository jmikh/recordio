/**
 * @fileoverview Codec resolution utilities for video export.
 *
 * Probes browser-level WebCodecs support and selects the best available
 * video and audio codecs.  Falls back gracefully:
 *   Video: H.264 High Profile → Baseline → VP9 software
 *   Audio: AAC → Opus
 */

export type { ExportQuality } from '../utils/exportQuality';
import type { ExportQuality } from '../utils/exportQuality';
export type ExportFps = 30;

export interface VideoCodecResult {
    config: VideoEncoderConfig;
    muxerCodec: 'avc' | 'hevc' | 'vp9' | 'av1';
    fallback: boolean;
    tried: string[];
}

export interface AudioCodecResult {
    encoderCodec: string;
    muxerCodec: 'aac' | 'opus';
    fallback: boolean;
}

// ============================================================================
// Video Codec Resolution
// ============================================================================

/**
 * Probe browser video codec support.
 * Tries H.264 profiles in order (best for playback compatibility),
 * then falls back to VP9 software encoding (always available in Chromium).
 */
export async function resolveVideoCodec(
    quality: ExportQuality,
    width: number,
    height: number,
): Promise<VideoCodecResult> {
    const bitrate = getBitrate(quality);
    const tried: string[] = [];

    // H.264 candidates ordered by preference (best quality first)
    const h264Candidates = getH264Candidates(quality);
    for (const codec of h264Candidates) {
        tried.push(codec);
        try {
            const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: 30 };
            const result = await VideoEncoder.isConfigSupported(config);
            if (result.supported) {
                // Probe hardware acceleration
                try {
                    const hwConfig: VideoEncoderConfig = { ...config, hardwareAcceleration: 'prefer-hardware' };
                    const hwResult = await VideoEncoder.isConfigSupported(hwConfig);
                    console.log(`[Export] Encoder HW accel for ${codec}: ${hwResult.supported}`);
                    if (hwResult.supported) {
                        return { config: hwConfig, muxerCodec: 'avc', fallback: false, tried };
                    }
                } catch {
                    console.log(`[Export] Encoder HW accel probe threw for ${codec}`);
                }
                return { config, muxerCodec: 'avc', fallback: false, tried };
            }
        } catch {
            // isConfigSupported can throw on some browsers
        }
    }

    // VP9 fallback — software encoding, always available in Chromium
    const vp9Codec = 'vp09.00.10.08'; // Profile 0, Level 1.0, 8-bit
    tried.push(vp9Codec);
    try {
        const config: VideoEncoderConfig = { codec: vp9Codec, width, height, bitrate, framerate: 30 };
        const result = await VideoEncoder.isConfigSupported(config);
        if (result.supported) {
            console.warn('[Export] H.264 not supported — falling back to VP9');
            // Probe hardware acceleration for VP9 too
            try {
                const hwConfig: VideoEncoderConfig = { ...config, hardwareAcceleration: 'prefer-hardware' };
                const hwResult = await VideoEncoder.isConfigSupported(hwConfig);
                console.log(`[Export] Encoder HW accel for VP9: ${hwResult.supported}`);
                if (hwResult.supported) {
                    return { config: hwConfig, muxerCodec: 'vp9', fallback: true, tried };
                }
            } catch {
                console.log(`[Export] Encoder HW accel probe threw for VP9`);
            }
            return { config, muxerCodec: 'vp9', fallback: true, tried };
        }
    } catch {
        // isConfigSupported can throw on some browsers
    }

    throw new Error(
        `[Export] No supported video codec found. Tried: ${tried.join(', ')} @ ${width}×${height}`
    );
}

/**
 * Return H.264 codec strings to try, ordered by preference.
 * Higher quality exports try High Profile first; lower quality uses Baseline.
 */
function getH264Candidates(q: ExportQuality): string[] {
    switch (q) {
        case '4K':
        case '2K':
            // High Profile Level 5.1, then Baseline as last resort
            return ['avc1.640033', 'avc1.42001f'];
        case '1080p':
            // High Profile Level 4.2, then Baseline
            return ['avc1.64002a', 'avc1.42001f'];
        case '720p':
        case '480p':
        default:
            return ['avc1.42001f'];
    }
}

// ============================================================================
// Audio Codec Resolution
// ============================================================================

/**
 * Probe browser audio codec support.
 * Prefer AAC (universal playback) → fall back to Opus (always available in Chromium,
 * works around missing platform AAC on Linux / Brave).
 */
export async function resolveAudioCodec(): Promise<AudioCodecResult> {
    const aacConfig = {
        codec: 'mp4a.40.2',
        numberOfChannels: 2,
        sampleRate: 44100,
        bitrate: 128000
    };

    try {
        const aacResult = await AudioEncoder.isConfigSupported(aacConfig);
        if (aacResult.supported) {
            return { encoderCodec: 'mp4a.40.2', muxerCodec: 'aac', fallback: false };
        }
    } catch {
        // isConfigSupported itself can throw on some browsers
    }

    console.warn('[Export] AAC not supported — falling back to Opus');
    return { encoderCodec: 'opus', muxerCodec: 'opus', fallback: true };
}

// ============================================================================
// Quality / Bitrate Helpers
// ============================================================================

export { getHeightForQuality } from '../utils/exportQuality';

export function getBitrate(q: ExportQuality): number {
    switch (q) {
        case '480p': return 2_000_000;  // 2 Mbps
        case '720p': return 5_000_000;  // 5 Mbps
        case '1080p': return 8_000_000; // 8 Mbps
        case '2K': return 15_000_000;   // 15 Mbps
        case '4K': return 25_000_000;   // 25 Mbps
    }
}
