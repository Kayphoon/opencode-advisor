import type { AdvisorSessionState } from "./types.js";

const sessionStates = new Map<string, AdvisorSessionState>();

export function getOrCreateSessionState(sessionID: string, workspaceDir: string): AdvisorSessionState {
  let state = sessionStates.get(sessionID);
  if (!state) {
    state = {
      sessionID,
      workspaceDir,
      lastEvaluatedMessageID: null,
      consecutiveAdvisorTurns: 0,
      userTurnCount: 0,
      immuneUntilUserTurn: 0,
      eligibleUpdates: 0,
      seenHashes: [],
      rollingSummary: "",
      diagnostics: [],
      isReviewing: false,
      abortController: null,
    };
    sessionStates.set(sessionID, state);
  }
  if (workspaceDir && state.workspaceDir !== workspaceDir) {
    state.workspaceDir = workspaceDir;
  }
  return state;
}

/** A genuine (non-advisor) user message: reset the circuit breaker and advance the user turn. */
export function resetConsecutiveAdvisorTurns(sessionID: string): void {
  const state = sessionStates.get(sessionID);
  if (state) {
    state.consecutiveAdvisorTurns = 0;
    state.userTurnCount += 1;
  }
}

export function recordDiagnostics(sessionID: string, diagnostics: string[]): void {
  const state = sessionStates.get(sessionID);
  if (!state) return;
  state.diagnostics = diagnostics.slice(-20);
}

export function removeSessionState(sessionID: string): void {
  const state = sessionStates.get(sessionID);
  if (state?.abortController) {
    state.abortController.abort();
  }
  sessionStates.delete(sessionID);
}

export function clearAllSessionStates(): void {
  for (const state of sessionStates.values()) {
    if (state.abortController) {
      state.abortController.abort();
    }
  }
  sessionStates.clear();
}
