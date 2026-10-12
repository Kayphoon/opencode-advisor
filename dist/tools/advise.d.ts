import type { AdviceNote, ToolDefinition } from "../types.js";
/**
 * The reviewer's single emission tool. When `requireEvidence` is on, a `blocker`
 * without cited evidence is rejected with an instruction to verify first — the
 * model gets a chance to self-correct before the guard also downgrades it.
 */
export declare function createAdviseTool(collectedNotes: AdviceNote[], requireEvidence: boolean): ToolDefinition;
//# sourceMappingURL=advise.d.ts.map