/**
 * @module stages
 * Stage handler registry — maps State → StageHandler.
 * Populated in Phase 4 as stages are extracted from the monolith.
 */

// Batch A: Bootstrap + Input
export { projectInit } from './project-init.js';
export { inputSelect } from './input-select.js';
export { inputYoutube } from './input-youtube.js';
export { inputAudio } from './input-audio.js';
export { inputText } from './input-text.js';

// Batch B: Transcription + Review  (Phase 4.6–4.8)
export { transcription } from './transcription.js';
export { transcriptReview } from './transcript-review.js';
export { processingSelect } from './processing-select.js';

// Batch C: Research + Article  (Phase 4.9–4.14)
export { researchPromptGen } from './research-prompt.js';
export { researchExecute } from './research-execute.js';
export { articleGenerate } from './article-generate.js';
export { articleReview } from './article-review.js';
export { translate } from './translate.js';
export { outputSelect } from './output-select.js';

// Batch D: Output + Finish  (Phase 4.15–4.18)
export { scriptGenerate } from './script-generate.js';
export { ttsRender } from './tts-render.js';
export { packageOutput } from './package-output.js';
export { complete } from './complete.js';
