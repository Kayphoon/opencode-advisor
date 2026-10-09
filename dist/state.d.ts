import type { AdvisorSessionState } from "./types.js";
export declare function getOrCreateSessionState(sessionID: string, workspaceDir: string): AdvisorSessionState;
export declare function resetConsecutiveAdvisorTurns(sessionID: string): void;
export declare function removeSessionState(sessionID: string): void;
export declare function clearAllSessionStates(): void;
//# sourceMappingURL=state.d.ts.map