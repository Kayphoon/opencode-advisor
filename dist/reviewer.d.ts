import type { AdviceNote, ResolvedModelConfig } from "./types.js";
/**
 * Run one reviewer pass: an independent, tool-using model loop over the delta.
 * Emits at most one batch of `advise` notes; terminates as soon as advise fires.
 */
export declare function runReviewerAgent(transcriptDelta: string, workspaceDir: string, watchdog: ResolvedModelConfig, requireEvidence: boolean, signal: AbortSignal): Promise<AdviceNote[]>;
//# sourceMappingURL=reviewer.d.ts.map