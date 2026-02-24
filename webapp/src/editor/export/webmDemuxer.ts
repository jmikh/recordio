/**
 * @fileoverview Minimal EBML/WebM demuxer for extracting encoded video frames.
 *
 * Handles MediaRecorder output correctly, including unknown-length elements
 * (which use all-ones VINTs that overflow JS 32-bit integers in other parsers).
 *
 * Only extracts what's needed for WebCodecs VideoDecoder:
 * - Track metadata (codec, dimensions)
 * - SimpleBlock data (timestamp, keyframe flag, encoded frame data)
 */

export interface DemuxedVideoTrack {
    codec: string; // 'V_VP8' or 'V_VP9'
    width: number;
    height: number;
    codecPrivate?: Uint8Array;
}

export interface DemuxedVideoPacket {
    data: Uint8Array;
    timestampMs: number;
    isKeyframe: boolean;
}

export interface DemuxResult {
    track: DemuxedVideoTrack;
    packets: DemuxedVideoPacket[];
}

// Well-known EBML element IDs
const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114d9b74;
const SEGMENT_INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675;
const CUES = 0x1c53bb6b;
const TAGS = 0x1254c367;
const VOID = 0xec;

// Track elements
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const CODEC_ID = 0x86;
const CODEC_PRIVATE = 0x63a2;
const VIDEO_SETTINGS = 0xe0;
const PIXEL_WIDTH = 0xb0;
const PIXEL_HEIGHT = 0xba;

// Cluster elements
const CLUSTER_TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;

// Timecode scale
const TIMECODE_SCALE_ID = 0x2ad7b1;

/**
 * Read a variable-length EBML integer (VINT) without 32-bit truncation.
 * Returns [value, bytesConsumed] or null if not enough data.
 *
 * Unlike jswebm, this uses only multiplication and addition (no `<<`)
 * to avoid JavaScript's 32-bit integer truncation on shift operators.
 */
function readVint(data: Uint8Array, offset: number): [number, number] | null {
    if (offset >= data.length) return null;

    const firstByte = data[offset];
    let width = 1;
    let mask = 0x80;

    while (width <= 8 && !(firstByte & mask)) {
        width++;
        mask >>= 1;
    }

    if (width > 8) return null; // Invalid VINT
    if (offset + width > data.length) return null; // Not enough data

    // Read the value WITHOUT using << to avoid 32-bit truncation
    // Use multiplication by powers of 256 instead
    let value = firstByte & (mask - 1); // Strip the marker bit
    for (let i = 1; i < width; i++) {
        value = value * 256 + data[offset + i];
    }

    return [value, width];
}

/**
 * Read an EBML element ID. Element IDs keep their marker bit (unlike sizes).
 */
function readElementId(data: Uint8Array, offset: number): [number, number] | null {
    if (offset >= data.length) return null;

    const firstByte = data[offset];
    let width = 1;
    let mask = 0x80;

    while (width <= 4 && !(firstByte & mask)) {
        width++;
        mask >>= 1;
    }

    if (width > 4) return null; // IDs are max 4 bytes
    if (offset + width > data.length) return null;

    // For element IDs, keep the marker bit
    let value = firstByte;
    for (let i = 1; i < width; i++) {
        value = value * 256 + data[offset + i];
    }

    return [value, width];
}

/**
 * Check if a VINT value represents "unknown length" (all data bits set to 1).
 */
function isUnknownSize(value: number, width: number): boolean {
    // Unknown size has all data bits = 1
    // Width 1: 0x7F, Width 2: 0x3FFF, Width 3: 0x1FFFFF, etc.
    const maxValues = [0x7f, 0x3fff, 0x1fffff, 0x0fffffff, 0x07ffffffff, 0x03ffffffffff, 0x01ffffffffffff, 0x00ffffffffffffff];
    return value === maxValues[width - 1];
}

/** Read an unsigned integer of `size` bytes from the data */
function readUint(data: Uint8Array, offset: number, size: number): number {
    let value = 0;
    for (let i = 0; i < size; i++) {
        value = value * 256 + data[offset + i];
    }
    return value;
}

/** Read a UTF-8 string from the data */
function readString(data: Uint8Array, offset: number, size: number): string {
    const bytes = data.subarray(offset, offset + size);
    // Remove trailing null bytes
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    return new TextDecoder().decode(bytes.subarray(0, end));
}

/**
 * Demux a WebM file into track metadata and encoded video packets.
 */
export function demuxWebm(buffer: ArrayBuffer): DemuxResult {
    const data = new Uint8Array(buffer);
    let pos = 0;

    let videoTrack: DemuxedVideoTrack | null = null;
    const packets: DemuxedVideoPacket[] = [];
    let timecodeScale = 1_000_000; // Default: 1ms per timecode unit

    // --- Parse EBML header (skip it) ---
    const headerIdResult = readElementId(data, pos);
    if (!headerIdResult || headerIdResult[0] !== EBML_HEADER) {
        throw new Error('[WebmDemuxer] Not a valid EBML file');
    }
    pos += headerIdResult[1];

    const headerSizeResult = readVint(data, pos);
    if (!headerSizeResult) throw new Error('[WebmDemuxer] Invalid EBML header size');
    pos += headerSizeResult[1];
    pos += headerSizeResult[0]; // Skip header content

    // --- Parse Segment ---
    const segIdResult = readElementId(data, pos);
    if (!segIdResult || segIdResult[0] !== SEGMENT) {
        throw new Error('[WebmDemuxer] Segment element not found');
    }
    pos += segIdResult[1];

    const segSizeResult = readVint(data, pos);
    if (!segSizeResult) throw new Error('[WebmDemuxer] Invalid Segment size');
    const segSizeWidth = segSizeResult[1];
    pos += segSizeWidth;

    // For unknown-length segments (MediaRecorder), treat end as file end
    const segmentEnd = isUnknownSize(segSizeResult[0], segSizeWidth)
        ? data.length
        : pos + segSizeResult[0];

    // --- Parse Segment children ---
    while (pos < segmentEnd && pos < data.length) {
        const idResult = readElementId(data, pos);
        if (!idResult) break;
        pos += idResult[1];

        const sizeResult = readVint(data, pos);
        if (!sizeResult) break;
        const sizeWidth = sizeResult[1];
        pos += sizeWidth;

        const elementId = idResult[0];
        const elementSize = sizeResult[0];
        const isUnknown = isUnknownSize(elementSize, sizeWidth);
        const elementEnd = isUnknown ? data.length : pos + elementSize;

        switch (elementId) {
            case SEGMENT_INFO:
                // Parse for timecodeScale
                parseSegmentInfo(data, pos, elementEnd);
                pos = elementEnd;
                break;

            case TRACKS:
                videoTrack = parseTracks(data, pos, elementEnd);
                pos = elementEnd;
                break;

            case CLUSTER:
                // Clusters may have unknown length — parse until we hit the next top-level element
                pos = parseCluster(data, pos, elementEnd, isUnknown, packets, timecodeScale);
                break;

            case SEEK_HEAD:
            case CUES:
            case TAGS:
            case VOID:
            default:
                // Skip
                pos = elementEnd;
                break;
        }
    }

    if (!videoTrack) {
        throw new Error('[WebmDemuxer] No video track found');
    }

    return { track: videoTrack, packets };

    // --- Helpers scoped to this function ---

    function parseSegmentInfo(d: Uint8Array, start: number, end: number) {
        let p = start;
        while (p < end) {
            const id = readElementId(d, p);
            if (!id) break;
            p += id[1];
            const sz = readVint(d, p);
            if (!sz) break;
            p += sz[1];

            if (id[0] === TIMECODE_SCALE_ID) {
                timecodeScale = readUint(d, p, sz[0]);
            }
            p += sz[0];
        }
    }

    function parseTracks(d: Uint8Array, start: number, end: number): DemuxedVideoTrack | null {
        let p = start;
        while (p < end) {
            const id = readElementId(d, p);
            if (!id) break;
            p += id[1];
            const sz = readVint(d, p);
            if (!sz) break;
            p += sz[1];

            if (id[0] === TRACK_ENTRY) {
                const track = parseTrackEntry(d, p, p + sz[0]);
                if (track) return track;
            }
            p += sz[0];
        }
        return null;
    }

    function parseTrackEntry(d: Uint8Array, start: number, end: number): DemuxedVideoTrack | null {
        let p = start;
        let trackType = 0;
        let codecId = '';
        let width = 0;
        let height = 0;
        let codecPrivate: Uint8Array | undefined;

        while (p < end) {
            const id = readElementId(d, p);
            if (!id) break;
            p += id[1];
            const sz = readVint(d, p);
            if (!sz) break;
            p += sz[1];

            switch (id[0]) {
                case TRACK_TYPE:
                    trackType = readUint(d, p, sz[0]);
                    break;
                case CODEC_ID:
                    codecId = readString(d, p, sz[0]);
                    break;
                case CODEC_PRIVATE:
                    codecPrivate = d.slice(p, p + sz[0]);
                    break;
                case VIDEO_SETTINGS: {
                    // Parse Video sub-element
                    let vp = p;
                    const vEnd = p + sz[0];
                    while (vp < vEnd) {
                        const vid = readElementId(d, vp);
                        if (!vid) break;
                        vp += vid[1];
                        const vsz = readVint(d, vp);
                        if (!vsz) break;
                        vp += vsz[1];

                        if (vid[0] === PIXEL_WIDTH) width = readUint(d, vp, vsz[0]);
                        else if (vid[0] === PIXEL_HEIGHT) height = readUint(d, vp, vsz[0]);
                        vp += vsz[0];
                    }
                    break;
                }
            }
            p += sz[0];
        }

        if (trackType === 1 && codecId) { // trackType 1 = video
            return { codec: codecId, width, height, codecPrivate };
        }
        return null;
    }
}

/**
 * Parse a Cluster element, extracting SimpleBlocks.
 * Returns the position after the cluster.
 */
function parseCluster(
    data: Uint8Array,
    start: number,
    end: number,
    isUnknownLength: boolean,
    packets: DemuxedVideoPacket[],
    timecodeScale: number
): number {
    let pos = start;
    let clusterTimecode = 0;

    while (pos < end && pos < data.length) {
        const idResult = readElementId(data, pos);
        if (!idResult) break;

        // If this cluster has unknown length, check if we've hit a new top-level element
        if (isUnknownLength) {
            const peekId = idResult[0];
            if (peekId === CLUSTER || peekId === CUES || peekId === TAGS ||
                peekId === SEGMENT_INFO || peekId === TRACKS || peekId === SEEK_HEAD) {
                // End of this cluster — don't consume the element
                return pos;
            }
        }

        pos += idResult[1];
        const sizeResult = readVint(data, pos);
        if (!sizeResult) break;
        pos += sizeResult[1];

        const elementId = idResult[0];
        const elementSize = sizeResult[0];

        switch (elementId) {
            case CLUSTER_TIMECODE:
                clusterTimecode = readUint(data, pos, elementSize);
                pos += elementSize;
                break;

            case SIMPLE_BLOCK:
                parseSimpleBlock(data, pos, elementSize, clusterTimecode, packets, timecodeScale);
                pos += elementSize;
                break;

            case BLOCK_GROUP: {
                // Parse BlockGroup for Block element
                let bgPos = pos;
                const bgEnd = pos + elementSize;
                while (bgPos < bgEnd) {
                    const bgId = readElementId(data, bgPos);
                    if (!bgId) break;
                    bgPos += bgId[1];
                    const bgSz = readVint(data, bgPos);
                    if (!bgSz) break;
                    bgPos += bgSz[1];

                    if (bgId[0] === BLOCK) {
                        parseSimpleBlock(data, bgPos, bgSz[0], clusterTimecode, packets, timecodeScale);
                    }
                    bgPos += bgSz[0];
                }
                pos += elementSize;
                break;
            }

            default:
                pos += elementSize;
                break;
        }
    }

    return pos;
}

/**
 * Parse a SimpleBlock/Block element.
 * Format: track number (VINT) + timecode (int16) + flags (uint8) + frame data
 */
function parseSimpleBlock(
    data: Uint8Array,
    offset: number,
    size: number,
    clusterTimecode: number,
    packets: DemuxedVideoPacket[],
    timecodeScale: number
) {
    let pos = offset;
    const blockEnd = offset + size;

    // Track number (VINT)
    const trackResult = readVint(data, pos);
    if (!trackResult) return;
    const trackNum = trackResult[0];
    pos += trackResult[1];

    if (trackNum !== 1) return; // Only process first video track (track 1)

    // Timecode offset (signed 16-bit)
    if (pos + 2 > blockEnd) return;
    const timecodeOffset = (data[pos] << 8 | data[pos + 1]) << 16 >> 16; // Sign extend
    pos += 2;

    // Flags
    if (pos >= blockEnd) return;
    const flags = data[pos];
    pos += 1;

    const isKeyframe = !!(flags & 0x80);
    const lacing = (flags >> 1) & 0x03;

    if (lacing !== 0) {
        // Skip laced frames for simplicity — MediaRecorder doesn't use lacing
        return;
    }

    // Frame data
    const frameData = data.slice(pos, blockEnd);

    // Timestamp: (clusterTimecode + timecodeOffset) * timecodeScale / 1_000_000 → milliseconds
    const rawTimestamp = clusterTimecode + timecodeOffset;
    const timestampMs = (rawTimestamp * timecodeScale) / 1_000_000;

    packets.push({
        data: frameData,
        timestampMs,
        isKeyframe
    });
}
