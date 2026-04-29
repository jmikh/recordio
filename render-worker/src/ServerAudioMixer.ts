/**
 * Server-side audio mixer using FFmpeg.
 *
 * Replaces the browser's OfflineAudioContext + SoundTouch.js pipeline.
 * Builds an FFmpeg command with filter graphs to:
 * - Extract and time-stretch audio segments per OutputWindow speed
 * - Mix screen audio, microphone, background music, and sound effects
 * - Fade out background music at the end
 * - Output a single AAC-encoded audio file
 *
 * FFmpeg's `atempo` filter preserves pitch when changing speed (same
 * algorithm family as SoundTouch — WSOLA-based). For speeds outside
 * the [0.5, 100] range supported by a single `atempo`, we chain
 * multiple instances (e.g., 4x = atempo=2.0,atempo=2.0).
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Project, ScreenMetadata } from '@shared/types';
import type { OutputWindow } from '@shared/types/timeline';
import type { TimeMapper } from '@shared/mappers/timeMapper';
import type { UserEvents } from '@shared/types/events';

export interface AudioMixOptions {
  project: Project;
  totalDurationSec: number;
  userEvents?: UserEvents;
  timeMapper?: TimeMapper;
  /** Directory containing downloaded media files (screen.webm, camera.webm, etc.) */
  mediaDir: string;
  /** Path to write the output audio file */
  outputPath: string;
}

/**
 * Build an FFmpeg command to mix all audio sources and produce a single
 * AAC audio file. Returns the output file path.
 */
export async function mixAudio(options: AudioMixOptions): Promise<string> {
  const { project, totalDurationSec, userEvents, timeMapper, mediaDir, outputPath } = options;
  const audioSettings = project.settings.audio;

  const inputs: string[] = [];
  const filterParts: string[] = [];
  let inputIndex = 0;
  const streamLabels: string[] = [];

  // --- Screen audio ---
  const screenHasAudio = (project.screenSource as ScreenMetadata).hasAudio;
  if (screenHasAudio && !audioSettings?.muteScreenAudio) {
    const screenPath = findMediaFile(mediaDir, 'screen');
    if (screenPath) {
      const idx = inputIndex++;
      inputs.push('-i', screenPath);
      const label = buildWindowedAudio(
        filterParts, idx, project.timeline.outputWindows,
        audioSettings?.screenVolume ?? 1, `screen`
      );
      if (label) streamLabels.push(label);
    }
  }

  // --- Microphone audio ---
  if (project.microphoneSource && !audioSettings?.muteMicrophone) {
    const micPath = findMediaFile(mediaDir, 'mic');
    if (micPath) {
      const idx = inputIndex++;
      inputs.push('-i', micPath);
      const label = buildWindowedAudio(
        filterParts, idx, project.timeline.outputWindows,
        audioSettings?.microphoneVolume ?? 1, `mic`
      );
      if (label) streamLabels.push(label);
    }
  }

  // --- Background music ---
  if (audioSettings?.music?.enabled) {
    const hasMusic = audioSettings.music.source === 'preset'
      ? !!audioSettings.music.presetUrl
      : !!audioSettings.music.storagePath;

    if (hasMusic) {
      const musicPath = findMediaFile(mediaDir, 'music');
      if (musicPath) {
        const idx = inputIndex++;
        inputs.push('-i', musicPath);

        const volume = audioSettings.music.volume ?? 0.3;
        const fadeMs = audioSettings.music.fadeOutDurationMs ?? 3000;
        const fadeSec = fadeMs / 1000;
        const fadeStart = Math.max(0, totalDurationSec - fadeSec);

        // Loop music to cover full duration, apply volume + fade
        let filter = `[${idx}:a]aloop=loop=-1:size=2e+09,atrim=0:${totalDurationSec},asetpts=PTS-STARTPTS`;
        filter += `,volume=${volume}`;
        if (fadeSec > 0) {
          filter += `,afade=t=out:st=${fadeStart}:d=${fadeSec}`;
        }
        const label = `music`;
        filter += `[${label}]`;
        filterParts.push(filter);
        streamLabels.push(`[${label}]`);
      }
    }
  }

  // --- Click/drag sound effects ---
  // For simplicity, click/drag sounds are omitted in the server render.
  // They're tiny WAV files that would need to be downloaded and scheduled
  // at precise timestamps. Can be added later if needed.
  // The visual click/drag effects are still rendered by the painters.

  // If no audio sources, generate silence
  if (streamLabels.length === 0) {
    return generateSilence(outputPath, totalDurationSec);
  }

  // --- Mix all streams ---
  let filterComplex: string;
  if (streamLabels.length === 1) {
    // Single source — just pass through, trim to exact duration
    filterComplex = filterParts.join(';\n') +
      `;\n${streamLabels[0]}atrim=0:${totalDurationSec},asetpts=PTS-STARTPTS[out]`;
  } else {
    // Multiple sources — mix together
    filterComplex = filterParts.join(';\n') +
      `;\n${streamLabels.join('')}amix=inputs=${streamLabels.length}:duration=longest:dropout_transition=0,` +
      `atrim=0:${totalDurationSec},asetpts=PTS-STARTPTS[out]`;
  }

  const args = [
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-y',
    outputPath,
  ];

  await runFFmpeg(args);
  return outputPath;
}

/**
 * Build filter graph segments for a source audio track with per-window
 * trimming and tempo adjustment. Each output window may have a different
 * playback speed.
 *
 * Returns the final stream label (e.g., "[screen]") or null if no segments.
 */
function buildWindowedAudio(
  filterParts: string[],
  inputIdx: number,
  outputWindows: OutputWindow[],
  volume: number,
  name: string,
): string | null {
  if (outputWindows.length === 0) return null;

  const segLabels: string[] = [];
  let outputOffset = 0;

  for (let i = 0; i < outputWindows.length; i++) {
    const win = outputWindows[i];
    const speed = win.speed || 1.0;
    const startSec = win.startMs / 1000;
    const endSec = win.endMs / 1000;
    const sourceDuration = endSec - startSec;
    const outputDuration = sourceDuration / speed;
    const segLabel = `${name}_s${i}`;

    // Trim the source audio to this window's range
    let filter = `[${inputIdx}:a]atrim=${startSec}:${endSec},asetpts=PTS-STARTPTS`;

    // Apply tempo change if speed ≠ 1
    if (Math.abs(speed - 1.0) >= 0.001) {
      filter += `,${buildAtempoChain(speed)}`;
    }

    // Apply volume
    filter += `,volume=${volume}`;

    // Delay to position this segment at the correct output time
    if (outputOffset > 0) {
      const delayMs = Math.round(outputOffset * 1000);
      filter += `,adelay=${delayMs}|${delayMs}`;
    }

    filter += `[${segLabel}]`;
    filterParts.push(filter);
    segLabels.push(`[${segLabel}]`);

    outputOffset += outputDuration;
  }

  if (segLabels.length === 0) return null;

  if (segLabels.length === 1) {
    // Single window — rename to final label
    const rename = `${segLabels[0]}acopy[${name}]`;
    filterParts.push(rename);
  } else {
    // Concatenate all window segments
    const concat = `${segLabels.join('')}concat=n=${segLabels.length}:v=0:a=1[${name}]`;
    filterParts.push(concat);
  }

  return `[${name}]`;
}

/**
 * Build an atempo filter chain for the given speed.
 * FFmpeg's atempo supports [0.5, 100.0]. For values outside this range,
 * chain multiple atempo filters. For example, 4x = atempo=2.0,atempo=2.0.
 */
function buildAtempoChain(speed: number): string {
  const parts: string[] = [];
  let remaining = speed;

  // Handle speeds > 2.0 by chaining 2.0x filters
  while (remaining > 2.0) {
    parts.push('atempo=2.0');
    remaining /= 2.0;
  }

  // Handle speeds < 0.5 by chaining 0.5x filters
  while (remaining < 0.5) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }

  // Add the remaining factor
  parts.push(`atempo=${remaining.toFixed(6)}`);

  return parts.join(',');
}

/**
 * Generate a silent audio file of the specified duration.
 */
async function generateSilence(outputPath: string, durationSec: number): Promise<string> {
  await runFFmpeg([
    '-f', 'lavfi',
    '-i', `anullsrc=r=44100:cl=stereo`,
    '-t', String(durationSec),
    '-c:a', 'aac',
    '-b:a', '128k',
    '-y',
    outputPath,
  ]);
  return outputPath;
}

/**
 * Run an FFmpeg command and return a promise that resolves on success.
 */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    ffmpeg.stderr!.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}:\n${stderr.slice(-2000)}`));
      } else {
        resolve();
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Find a media file in the directory by prefix (e.g., 'screen' → 'screen.webm').
 * Returns the full path if found, null otherwise.
 */
function findMediaFile(mediaDir: string, prefix: string): string | null {
  const extensions = ['.webm', '.mp4', '.wav', '.mp3', '.aac', '.ogg'];
  for (const ext of extensions) {
    const filePath = path.join(mediaDir, `${prefix}${ext}`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}
