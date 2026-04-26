/**
 * Render worker entry point.
 *
 * This runs inside a Fly.io Machine. It reads JOB_ID from the environment,
 * fetches the job details from Supabase, runs the render pipeline, uploads
 * the result, and exits (machine auto-destroys on exit).
 *
 * Implemented in Phase 3 (ServerExportPipeline).
 */

export { nodeRenderContext } from './nodeRenderContext';
export { ServerFrameExtractor } from './ServerFrameExtractor';
export { mixAudio } from './ServerAudioMixer';
export { renderProject, type RenderJobConfig, type RenderResult } from './ServerExportPipeline';
