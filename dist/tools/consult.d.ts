import type { NativeToolDefinition, ResolvedModelConfig, SessionMessageLike } from "../types.js";
export interface ConsultDeps {
    consult: ResolvedModelConfig;
    /** Fetch recent session messages for context. */
    getContextMessages: (sessionID: string) => Promise<SessionMessageLike[]>;
    /** How many recent messages to attach. 0 disables context attachment. */
    includeContextMessages: number;
}
/**
 * Intrinsic consultation tool (Claude Code "advisor tool" pattern).
 *
 * Registered with OpenCode so the *primary agent* can request guidance from a
 * stronger model at decision points — before committing to an approach, when
 * stuck on a recurring error, or before declaring a task done.
 */
export declare function createConsultTool(deps: ConsultDeps): NativeToolDefinition;
//# sourceMappingURL=consult.d.ts.map