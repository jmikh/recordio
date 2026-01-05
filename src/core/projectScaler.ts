import type { Project, Size, Rect, ViewportMotion, CameraSettings, ScreenSettings } from './types';

/**
 * Scales a project's spatial settings to match a new output size.
 * Useful for exporting at different resolutions (360p, 4K, etc.) while maintaining relative positioning and sizing.
 */
export function scaleProject(project: Project, newSize: Size): Project {
    const oldSize = project.settings.outputSize;

    // Calculate scale factors
    const scaleX = newSize.width / oldSize.width;
    const scaleY = newSize.height / oldSize.height;

    // Helper to scale a Rect
    const scaleRect = (rect: Rect): Rect => ({
        x: rect.x * scaleX,
        y: rect.y * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY
    });

    // Helper to scale Camera Settings
    const scaleCamera = (cam: CameraSettings): CameraSettings => ({
        ...cam,
        x: cam.x * scaleX,
        y: cam.y * scaleY,
        width: cam.width * scaleX,
        height: cam.height * scaleY,
        // Uniform scaling for border radius/width? Use average or max?
        // Usually dependent on the smaller dimension or just one. 
        // Let's use scaleX (width-based) as primary for borders/radius to keep consistent with width resizing.
        borderRadius: cam.borderRadius * ((scaleX + scaleY) / 2),
        borderWidth: cam.borderWidth * ((scaleX + scaleY) / 2),
        // TODO: Scale shadow and glow width (currently consts or implicitly handled by CSS/Canvas effects? 
        // Note: The types say 'hasShadow', 'hasGlow' boolean, but implementation might use fixed values.
        // If they become configurable numbers, scale them here.
    });

    // Helper to scale Screen Settings
    const scaleScreen = (screen: ScreenSettings): ScreenSettings => ({
        ...screen,
        borderWidth: screen.borderWidth * ((scaleX + scaleY) / 2),
    });

    // Scale Viewport Motions
    const newViewportMotions: ViewportMotion[] = project.timeline.recording.viewportMotions.map(m => ({
        ...m,
        rect: scaleRect(m.rect)
    }));

    // Clone and return new Project
    return {
        ...project,
        settings: {
            ...project.settings,
            outputSize: { ...newSize },
            camera: project.settings.camera ? scaleCamera(project.settings.camera) : undefined,
            screen: scaleScreen(project.settings.screen)
        },
        timeline: {
            ...project.timeline,
            recording: {
                ...project.timeline.recording,
                viewportMotions: newViewportMotions
            }
        }
    };
}
