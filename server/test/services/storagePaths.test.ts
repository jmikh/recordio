/**
 * Pins every key format: existing objects and stored *_storage_path
 * columns depend on them, and the purge jobs list by these prefixes.
 */
import { describe, expect, it } from 'vitest';
import {
    isProjectPath,
    isUserPath,
    projectAssetPath,
    projectMediaPath,
    projectRenderPath,
    projectStoragePrefix,
    projectThumbnailPath,
    screenshotRenderPath,
    screenshotSourcePath,
    screenshotStoragePrefix,
    screenshotThumbnailPath,
    storageFileName,
    userAssetPath,
    userStoragePrefix,
} from '../../src/services/storagePaths.js';

const U = 'user-1';
const P = 'project-1';
const S = 'shot-1';

describe('storagePaths', () => {
    it('user keys', () => {
        expect(userStoragePrefix(U)).toBe('user-1/');
        expect(userAssetPath(U, 'asset-1', 'png')).toBe('user-1/assets/asset-1.png');
    });

    it('project keys all sit under the project prefix', () => {
        expect(projectStoragePrefix(U, P)).toBe('user-1/project-1/');
        expect(projectMediaPath(U, P, 'screen')).toBe('user-1/project-1/screen.webm');
        expect(projectMediaPath(U, P, 'camera')).toBe('user-1/project-1/camera.webm');
        expect(projectMediaPath(U, P, 'mic')).toBe('user-1/project-1/mic.wav');
        expect(projectMediaPath(U, P, 'cameraMatte')).toBe('user-1/project-1/cameraMatte.webm');
        expect(projectThumbnailPath(U, P)).toBe('user-1/project-1/thumbnail.webp');
        expect(projectAssetPath(U, P, 'asset-1.webp')).toBe('user-1/project-1/assets/asset-1.webp');
        expect(projectRenderPath(U, P, { cloudVersion: 7, quality: '1080p', fps: 60 }))
            .toBe('user-1/project-1/renders/v7_1080p_60fps.mp4');
    });

    it('isProjectPath: any first segment, the project id second, no escaping segments', () => {
        expect(isProjectPath('user-1/project-1/screen.webm', P)).toBe(true);
        expect(isProjectPath('user-2/project-1/cameraMatte.webm', P)).toBe(true);
        expect(isProjectPath('user-1/project-1/assets/a.webp', P)).toBe(true);
        expect(isProjectPath('user-1/project-2/screen.webm', P)).toBe(false);
        expect(isProjectPath('user-1/assets/a.webp', P)).toBe(false);
        expect(isProjectPath('user-1/project-1', P)).toBe(false);
        expect(isProjectPath('user-1/project-1/../../user-2/x', P)).toBe(false);
        expect(isProjectPath('user-1/project-1//x', P)).toBe(false);
    });

    it('isUserPath: first segment is the user, no escaping segments', () => {
        expect(isUserPath('user-1/assets/a.webp', U)).toBe(true);
        expect(isUserPath('user-1/project-1/screen.webm', U)).toBe(true);
        expect(isUserPath('user-2/assets/a.webp', U)).toBe(false);
        expect(isUserPath('user-1', U)).toBe(false);
        expect(isUserPath('user-1/../user-2/a.webp', U)).toBe(false);
    });

    it('storageFileName is the last segment', () => {
        expect(storageFileName('user-1/assets/asset-1.webp')).toBe('asset-1.webp');
    });

    it('screenshot keys all sit under the screenshot prefix', () => {
        expect(screenshotStoragePrefix(U, S)).toBe('user-1/screenshots/shot-1/');
        expect(screenshotSourcePath(U, S)).toBe('user-1/screenshots/shot-1/source.png');
        expect(screenshotThumbnailPath(U, S)).toBe('user-1/screenshots/shot-1/thumbnail.webp');
        expect(screenshotRenderPath(U, S, 3)).toBe('user-1/screenshots/shot-1/renders/v3.png');
    });
});
