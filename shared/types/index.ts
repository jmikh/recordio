/**
 * Shared Types
 * 
 * Minimal types needed by BOTH extension and webapp.
 * Extension-only or webapp-only types should live in their respective packages.
 */

// Core primitives
export * from './core';

// Source metadata
export * from './source';

// User events
export * from './events';

// Raw recording (handoff format)
export * from './recording';

// Bridge communication
export * from './bridge';
