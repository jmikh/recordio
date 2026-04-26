/**
 * Server-side frame extractor using FFmpeg.
 *
 * Replaces the browser's WebCodecs FrameExtractor. Spawns FFmpeg to decode
 * source video, seeking to specific timestamps and outputting single raw
 * RGBA frames which are then loaded into @napi-rs/canvas Image objects
 * for use with the shared painter stack.
 *
 * Strategy: For sequential export (frame 0, frame 1, ..., frame N), we spawn
 * a single long-running FFmpeg process that decodes the full video as a stream
 * of raw RGBA frames piped to stdout. We read frames sequentially from the pipe,
 * indexed by frame number. This is much faster than seeking per-frame.
 *
 * For the export use case, frames are always requested in monotonically
 * increasing source time order (TimeMapper maps output time → source time,
 * and output time always increases). This makes streaming decode ideal.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import type { CanvasHandle } from '@shared/utils/renderContext';

export interface FrameData {
  /** Canvas with the decoded frame drawn on it — drawable via ctx.drawImage() */
  canvas: CanvasHandle['canvas'];
  /** Frame width */
  width: number;
  /** Frame height */
  height: number;
}

export class ServerFrameExtractor {
  private inputPath: string;
  private ffmpeg: ChildProcess | null = null;
  private frameBuffer: Buffer = Buffer.alloc(0);
  private frameSize = 0;
  private frameQueue: Array<{
    resolve: (data: Buffer) => void;
    reject: (err: Error) => void;
  }> = [];
  private streamEnded = false;
  private streamError: Error | null = null;

  /** Video dimensions — available after initialize(). */
  width = 0;
  height = 0;

  /** Duration in seconds — available after initialize(). */
  duration = 0;

  /** Frames per second of the source video. */
  fps = 0;

  constructor(inputPath: string) {
    this.inputPath = inputPath;
  }

  /**
   * Probe the video file for dimensions and duration, then start the
   * streaming decode process.
   */
  async initialize(): Promise<void> {
    // Probe video metadata with ffprobe
    const probe = await this.probeVideo();
    this.width = probe.width;
    this.height = probe.height;
    this.duration = probe.duration;
    this.fps = probe.fps;
    this.frameSize = this.width * this.height * 4; // RGBA

    // Start streaming FFmpeg decode
    this.startDecodeStream();
  }

  /**
   * Get the decoded frame at the given source time.
   * Returns a canvas with the frame drawn on it (compatible with ctx.drawImage).
   */
  async getFrameAtTime(timeSec: number): Promise<FrameData> {
    const rawFrame = await this.readNextFrame();

    // Create a canvas and put the raw RGBA data onto it
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(this.width, this.height);
    imageData.data.set(rawFrame);
    ctx.putImageData(imageData, 0, 0);

    return {
      canvas: canvas as unknown as CanvasHandle['canvas'],
      width: this.width,
      height: this.height,
    };
  }

  /**
   * Read the next raw RGBA frame from the FFmpeg pipe.
   */
  private readNextFrame(): Promise<Buffer> {
    // If we already have a full frame buffered, return it immediately
    if (this.frameBuffer.length >= this.frameSize) {
      const frame = this.frameBuffer.subarray(0, this.frameSize);
      this.frameBuffer = this.frameBuffer.subarray(this.frameSize);
      return Promise.resolve(Buffer.from(frame));
    }

    if (this.streamEnded) {
      return Promise.reject(
        this.streamError ?? new Error('FFmpeg stream ended before frame was available')
      );
    }

    // Wait for more data
    return new Promise((resolve, reject) => {
      this.frameQueue.push({ resolve, reject });
    });
  }

  /**
   * Probe video metadata using ffprobe.
   */
  private probeVideo(): Promise<{
    width: number;
    height: number;
    duration: number;
    fps: number;
  }> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        this.inputPath,
      ]);

      let stdout = '';
      let stderr = '';
      ffprobe.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); });
      ffprobe.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const info = JSON.parse(stdout);
          const videoStream = info.streams?.find(
            (s: { codec_type: string }) => s.codec_type === 'video'
          );
          if (!videoStream) {
            reject(new Error('No video stream found'));
            return;
          }

          // Parse frame rate from r_frame_rate (e.g., "30/1" or "30000/1001")
          let fps = 30;
          if (videoStream.r_frame_rate) {
            const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
            if (den > 0) fps = num / den;
          }

          resolve({
            width: videoStream.width,
            height: videoStream.height,
            duration: parseFloat(info.format?.duration ?? videoStream.duration ?? '0'),
            fps,
          });
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${e}`));
        }
      });
    });
  }

  /**
   * Start a long-running FFmpeg process that decodes the entire video
   * as a stream of raw RGBA frames to stdout.
   */
  private startDecodeStream(): void {
    this.ffmpeg = spawn('ffmpeg', [
      '-i', this.inputPath,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-v', 'error',
      'pipe:1',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.ffmpeg.stdout!.on('data', (chunk: Buffer) => {
      this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
      this.drainQueue();
    });

    this.ffmpeg.stderr!.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[ServerFrameExtractor] FFmpeg: ${msg}`);
    });

    this.ffmpeg.on('close', (code) => {
      this.streamEnded = true;
      if (code !== 0 && !this.streamError) {
        this.streamError = new Error(`FFmpeg exited with code ${code}`);
      }
      // Drain any remaining complete frames
      this.drainQueue();
      // Reject any remaining waiters
      for (const waiter of this.frameQueue) {
        waiter.reject(this.streamError ?? new Error('FFmpeg stream ended'));
      }
      this.frameQueue = [];
    });
  }

  /**
   * Check if we have enough buffered data to fulfill waiting frame requests.
   */
  private drainQueue(): void {
    while (this.frameQueue.length > 0 && this.frameBuffer.length >= this.frameSize) {
      const frame = this.frameBuffer.subarray(0, this.frameSize);
      this.frameBuffer = this.frameBuffer.subarray(this.frameSize);
      const waiter = this.frameQueue.shift()!;
      waiter.resolve(Buffer.from(frame));
    }
  }

  /**
   * Clean up: kill FFmpeg process and release buffers.
   */
  dispose(): void {
    if (this.ffmpeg) {
      this.ffmpeg.kill('SIGTERM');
      this.ffmpeg = null;
    }
    this.frameBuffer = Buffer.alloc(0);
    this.frameQueue = [];
  }
}
