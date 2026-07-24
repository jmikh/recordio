/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;
    /** Fastify API server base URL — REQUIRED (all API calls go through it since the edge-fn decommission). Local dev: http://localhost:8090 */
    readonly VITE_API_URL?: string;
}

declare module '*.png' {
    const src: string;
    export default src;
}

declare module '*.jpg' {
    const src: string;
    export default src;
}

declare module '*.jpeg' {
    const src: string;
    export default src;
}

declare module '*.svg' {
    const src: string;
    export default src;
}

declare module '*.webp' {
    const src: string;
    export default src;
}

declare module 'soundtouchjs' {
    export class SoundTouch {
        tempo: number;
        rate: number;
        pitch: number;
        inputBuffer: FifoSampleBuffer;
        outputBuffer: FifoSampleBuffer;
        clear(): void;
        process(): void;
    }

    export class WebAudioBufferSource {
        constructor(buffer: AudioBuffer);
        position: number;
        extract(target: Float32Array, numFrames: number, position?: number): number;
    }

    export class SimpleFilter {
        constructor(source: WebAudioBufferSource, pipe: SoundTouch, callback?: () => void);
        sourcePosition: number;
        extract(target: Float32Array, numFrames: number): number;
    }

    export class FifoSampleBuffer {
        frameCount: number;
        vector: Float32Array;
        clear(): void;
    }
}
