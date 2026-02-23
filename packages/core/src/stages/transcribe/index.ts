/**
 * Empty stub for transcribe barrel — the actual transcribe sub-stages
 * live inside the ingest stages (captions, ytdlp, yt-asr).
 * This re-exports them for discoverability.
 */
export { captionsStage, ytdlpSubsStage, ytAsrStage } from '../ingest/youtube.js';
