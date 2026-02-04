/**
 * Shared Types
 * 
 * Minimal types needed by BOTH extension and webapp.
 * Extension-only or webapp-only types should live in their respective packages.
 */

// Core primitives, source metadata, and raw recording
export * from './core';

// User events
export * from './events';

// Bridge communication
export * from './bridge';
