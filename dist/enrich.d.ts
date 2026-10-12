import type { AdvisorSessionState, PluginContextLike } from "./types.js";
/**
 * Deterministic enrichment: facts obtained without the model.
 * Cheaper, faster, and hallucination-proof compared to agentic retrieval.
 */
export declare function collectDeterministicSignals(ctx: PluginContextLike, state: AdvisorSessionState, signal: AbortSignal): Promise<string>;
//# sourceMappingURL=enrich.d.ts.map