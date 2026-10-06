/**
 * Background-removed camera: combines a camera frame with its person mask
 * (CameraMatteMetadata — grayscale, white = person) into an RGBA cutout.
 * Canvas 2D has no luminance-to-alpha operation, so this is one tiny WebGL
 * pass on a shared OffscreenCanvas; it runs the same in the editor and in
 * export / the render worker.
 *
 * Callers must pass a mask decoded for the same timestamp as the camera
 * frame: export decodes both at one source time; the editor looks the mask
 * up by the camera frame's own timestamp (webapp/src/editor/cameraMatte/MaskPlayer.ts).
 */
import type { Project, Size } from '../types';
import { getActiveCameraMatte } from '../utils/cameraMatte';

/**
 * Mask values below the low edge are fully transparent, above the high edge
 * fully opaque. Tightens the soft band the model + video encoder leave
 * around the silhouette without making it jagged.
 */
const EDGE_LOW = 0.3;
const EDGE_HIGH = 0.7;

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
    v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_color;
uniform sampler2D u_mask;
varying vec2 v_uv;
void main() {
    vec3 rgb = texture2D(u_color, v_uv).rgb;
    float a = smoothstep(${EDGE_LOW.toFixed(2)}, ${EDGE_HIGH.toFixed(2)}, texture2D(u_mask, v_uv).r);
    gl_FragColor = vec4(rgb * a, a);
}`;

interface GlState {
    canvas: OffscreenCanvas;
    gl: WebGLRenderingContext;
    colorTexture: WebGLTexture;
    maskTexture: WebGLTexture;
}

/** undefined = not tried yet; null = WebGL unavailable here */
let glState: GlState | null | undefined;
let warnedUnavailable = false;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`[cameraCutout] shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
}

/** Non-power-of-two video textures: no mipmaps, clamp to edge. */
function createVideoTexture(gl: WebGLRenderingContext, unit: number): WebGLTexture {
    const texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
}

function initGl(): GlState | null {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl', {
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        antialias: false,
        depth: false,
        stencil: false,
    }) as WebGLRenderingContext | null;
    if (!gl) return null;

    try {
        const program = gl.createProgram()!;
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(`[cameraCutout] program link failed: ${gl.getProgramInfoLog(program)}`);
        }
        gl.useProgram(program);

        // Full-viewport quad as a triangle strip
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(program, 'a_pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        const colorTexture = createVideoTexture(gl, 0);
        const maskTexture = createVideoTexture(gl, 1);
        gl.uniform1i(gl.getUniformLocation(program, 'u_color'), 0);
        gl.uniform1i(gl.getUniformLocation(program, 'u_mask'), 1);

        return { canvas, gl, colorTexture, maskTexture };
    } catch (err) {
        console.error(err);
        return null;
    }
}

/** A video element that hasn't decoded its current frame yet would upload an empty texture. */
function hasFrame(source: CanvasImageSource): boolean {
    if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
        return source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && source.videoWidth > 0;
    }
    return true;
}

/**
 * Render the cutout of one camera frame at `size` (the camera's source
 * size, so drawCamera's crop math applies unchanged). Returns the shared
 * canvas — draw it before the next call — or null when a frame isn't ready
 * or WebGL is unavailable.
 */
export function renderCameraCutout(
    color: CanvasImageSource,
    mask: CanvasImageSource,
    size: Size,
): CanvasImageSource | null {
    if (!hasFrame(color) || !hasFrame(mask)) return null;

    if (glState === undefined || glState?.gl.isContextLost()) glState = initGl();
    if (!glState) {
        if (!warnedUnavailable) {
            console.warn('[cameraCutout] WebGL unavailable — drawing the camera with its background');
            warnedUnavailable = true;
        }
        return null;
    }

    const { canvas, gl, colorTexture, maskTexture } = glState;
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, color as TexImageSource);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask as TexImageSource);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return canvas;
}

export interface CameraImage {
    /** The camera frame as recorded */
    image: CanvasImageSource;
    /** Its transparent background-removed cutout, while one is drawn */
    cutout: CanvasImageSource | null;
    /** How far the background is removed (0–1); 0 whenever `cutout` is null */
    cutoutAmount: number;
}

/**
 * What the camera layer draws this frame: the plain camera, plus its cutout
 * while `cutoutAmount` (ResolvedCameraState.cutoutAmount, or 1/0 from a
 * camera's removeBackground) is above 0 and both frames are ready.
 * `videoRefs` holds the camera frame under the camera's storagePath and,
 * while active, its mask under the matte's.
 */
export function resolveCameraImage(
    project: Project,
    videoRefs: { [storagePath: string]: CanvasImageSource },
    cutoutAmount: number,
): CameraImage | null {
    const camera = project.cameraSource;
    const video = camera ? videoRefs[camera.storagePath] : undefined;
    if (!camera || !video) return null;

    const matte = cutoutAmount > 0 ? getActiveCameraMatte(project) : null;
    const mask = matte ? videoRefs[matte.storagePath] : undefined;
    if (mask) {
        const cutout = renderCameraCutout(video, mask, camera.size);
        if (cutout) return { image: video, cutout, cutoutAmount: Math.min(1, cutoutAmount) };
    }
    return { image: video, cutout: null, cutoutAmount: 0 };
}
