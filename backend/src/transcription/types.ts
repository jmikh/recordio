export interface TranscribeWord {
    word: string;
    sourceStartTimeMs: number;
    sourceEndTimeMs: number;
}

export interface TranscribeSegment {
    sourceStartTimeMs: number;
    sourceEndTimeMs: number;
    words: TranscribeWord[];
}

export interface TranscribeResponse {
    segments: TranscribeSegment[];
    minutesUsed: number;
    cycleMinutesUsed: number;
    cycleMinutesLimit: number;
    cycleResetsAt: string;
}

export interface RateLimitInfo {
    minutesUsed: number;
    minutesLimit: number;
    resetsAt: Date;
}

export class RateLimitError extends Error {
    minutesUsed: number;
    minutesLimit: number;
    resetsAt: Date;

    constructor(info: RateLimitInfo) {
        super('Rate limit exceeded');
        this.name = 'RateLimitError';
        this.minutesUsed = info.minutesUsed;
        this.minutesLimit = info.minutesLimit;
        this.resetsAt = info.resetsAt;
    }
}
