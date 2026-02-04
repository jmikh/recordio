/**
 * Webapp Types Barrel
 * 
 * Unified type interface for the webapp/editor.
 * 
 * Type Hierarchy:
 * - @shared/types: Primitives (ID, TimeMs, Point, Size, Rect) and shared contracts
 * - ./settings: All project settings types
 * - ./timeline: Timeline, OutputWindow, ZoomAction, SpotlightAction, Captions
 * - ./project: The root Project entity
 * - ./deviceFrames: Device frame types
 */

// Re-export all shared primitives and contracts
export * from '@shared/types';

// Re-export all settings types
export * from './settings';

// Re-export timeline types (includes Captions)
export * from './timeline';

// Re-export project type
export * from './project';

// Re-export device frame types
export * from './deviceFrames';
