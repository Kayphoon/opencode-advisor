import type { AdvisorSessionState } from "./types.js";
export declare function getOrCreateSessionState(sessionID: string, workspaceDir: string): AdvisorSessionState;
/** A genuine (non-advisor) user message: reset the circuit breaker and advance the user turn. */
export declare function resetConsecutiveAdvisorTurns(sessionID: string): void;
export declare function recordDiagnostics(sessionID: string, diagnostics: string[]): void;
export declare function removeSessionState(sessionID: string): void;
export declare function clearAllSessionStates(): void;
//# sourceMappingURL=state.d.ts.map