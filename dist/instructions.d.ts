/**
 * Attach or update an advisor instruction entry in the target session.
 * OpenCode V2 announces instruction entries as updates at step boundaries
 * (<context key="advisor">...</context>) WITHOUT triggering a fake user prompt
 * or waking a redundant assistant response turn.
 */
export declare function putAdvisorInstruction(sessionID: string, text: string): Promise<void>;
/**
 * Remove the advisor instruction entry when all issues are resolved.
 */
export declare function removeAdvisorInstruction(sessionID: string): Promise<void>;
//# sourceMappingURL=instructions.d.ts.map